// The history walker of the terminal UI: spans check, outcome handling and stop rules.

import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus, PlayOutcomeKind, ScriptAction, StepProcessOutcomeKind } from "../../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3_replay_reverse_events.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";
import { isInstantSpannedByWalkCoverage, readWalkCoverage } from "../engineV3_walk_coverage.ts";
import { getFileRunState, setFileRunState, type FileRunState } from "./engineV3_tui_walk_state.ts";
import type { HistoryWalker, HistoryWalkerOptions, PlayOutcome, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";
import type { StoppedWalk } from "./engineV3_tui_consent.ts";
import { describeCrash, describeRefusedStop, formatShortSource } from "./engineV3_tui_walk_stop_text.ts";
import { isRepoWalkFinished, requestPlayOnce } from "./engineV3_tui_walk_play.ts";

// The caller of handleOutcome gives no visibility, so a walk requested again after an answer counts as visible.
const IS_REWALK_VISIBLE = true;

function isRepoSpanningInstant(options: HistoryWalkerOptions, file: Path, instant: Date): boolean {
    const repoFolder = getInverseRepoFolderForFile(options.storeFolder, options.projectFolder, file);
    const coverage = readWalkCoverage(repoFolder);
    if (coverage === undefined) {
        return false;
    }
    return isInstantSpannedByWalkCoverage(coverage, instant);
}

function writeRunState(options: HistoryWalkerOptions, file: Path, runState: FileRunState): void {
    setFileRunState(options.walkState, file, runState);
    options.onStatusChange(file, runState);
}

function writeStatus(options: HistoryWalkerOptions, file: Path, status: FileWalkStatus, reasonText: string | undefined): void {
    const previousRunState = getFileRunState(options.walkState, file);
    writeRunState(options, file, { status, reasonText, failedReplayCount: previousRunState.failedReplayCount });
}

function walkHistoryTo(options: HistoryWalkerOptions, currentTime: Date, file: Path, isVisible: boolean): boolean {
    if (isRepoSpanningInstant(options, file, currentTime)) {
        return true;
    }
    options.requestWalk({ file, startAt: currentTime, isPassingStops: false }, isVisible);
    return false;
}

function handleDoneOutcome(options: HistoryWalkerOptions, request: StepRequest, outcomeKind: StepProcessOutcomeKind): void {
    if (!isRepoSpanningInstant(options, request.file, request.startAt)) {
        writeStatus(options, request.file, FileWalkStatus.Crashed, `walk reported done but the coverage does not reach ${request.startAt.toISOString()}`);
        return;
    }
    writeStatus(options, request.file, FileWalkStatus.Idle, undefined);
    if (outcomeKind === StepProcessOutcomeKind.Covered) {
        walkHistoryTo(options, request.startAt, request.file, IS_REWALK_VISIBLE);
    }
}

function writePlayOutcome(options: HistoryWalkerOptions, file: Path, startAt: Date, playOutcome: PlayOutcome): void {
    if (playOutcome.kind === PlayOutcomeKind.Replayed) {
        writeStatus(options, file, FileWalkStatus.Idle, undefined);
        walkHistoryTo(options, startAt, file, IS_REWALK_VISIBLE);
        return;
    }
    if (playOutcome.kind === PlayOutcomeKind.ReplayRefused) {
        if (isRepoWalkFinished(options, file)) {
            writeStatus(options, file, FileWalkStatus.Idle, undefined);
            return;
        }
        const previousRunState = getFileRunState(options.walkState, file);
        writeRunState(options, file, { status: FileWalkStatus.Stopped, reasonText: playOutcome.reasonText, failedReplayCount: previousRunState.failedReplayCount + 1 });
        return;
    }
    writeStatus(options, file, FileWalkStatus.Crashed, playOutcome.reasonText);
}

async function playScript(options: HistoryWalkerOptions, lastStopByFileValue: Map<string, StoppedWalk>, playStartAtByFileValue: Map<string, Date>, file: Path, startAt: Date): Promise<void> {
    const lastStop = lastStopByFileValue.get(file.value);
    if (lastStop === undefined) {
        throw new Error(`playScript: no stop is known for ${file.toString()}`);
    }
    if (options.decideScriptAction(file, lastStop.eventType, lastStop.source) === ScriptAction.Refuse) {
        writeStatus(options, file, FileWalkStatus.Stopped, describeRefusedStop(lastStop.eventType, lastStop.source));
        return;
    }
    // const playOutcome = await options.requestPlay({ file });
    // writePlayOutcome(options, file, startAt, playOutcome);
    const playRun = await requestPlayOnce(options.requestPlay, playStartAtByFileValue, file, startAt);
    if (playRun !== undefined) { writePlayOutcome(options, file, playRun.oldestStartAt, playRun.playOutcome); }
}

async function handleScriptStop(options: HistoryWalkerOptions, playStartAtByFileValue: Map<string, Date>, request: StepRequest, source: string | null): Promise<void> {
    // const stopText = `stopped at ${FileEventType.ScriptMayWrite} ${source}`;
    const shortSource = formatShortSource(source);
    const scriptAction = options.decideScriptAction(request.file, FileEventType.ScriptMayWrite, source);
    if (scriptAction === ScriptAction.Refuse) {
        // writeStatus(options, request.file, FileWalkStatus.Stopped, `${stopText}: scripts are not allowed in this session`);
        // writeStatus(options, request.file, FileWalkStatus.Stopped, `stopped at ${FileEventType.ScriptMayWrite} ${shortSource}: scripts are not allowed in this session`);
        writeStatus(options, request.file, FileWalkStatus.Stopped, describeRefusedStop(FileEventType.ScriptMayWrite, source));
        return;
    }
    if (scriptAction === ScriptAction.WaitForKey) {
        // writeStatus(options, request.file, FileWalkStatus.Stopped, `${stopText}: press the play key`);
        writeStatus(options, request.file, FileWalkStatus.Stopped, `stopped at ${FileEventType.ScriptMayWrite}: press ${options.playKeyName} to run the script (${shortSource})`);
        return;
    }
    writeStatus(options, request.file, FileWalkStatus.Stopped, `stopped at ${FileEventType.ScriptMayWrite} ${shortSource}: running the script`);
    // const playOutcome = await options.requestPlay({ file: request.file });
    // writePlayOutcome(options, request.file, request.startAt, playOutcome);
    const playRun = await requestPlayOnce(options.requestPlay, playStartAtByFileValue, request.file, request.startAt);
    if (playRun !== undefined) { writePlayOutcome(options, request.file, playRun.oldestStartAt, playRun.playOutcome); }
}

async function handleOutcome(options: HistoryWalkerOptions, lastStopByFileValue: Map<string, StoppedWalk>, playStartAtByFileValue: Map<string, Date>, request: StepRequest, outcome: StepProcessOutcome): Promise<void> {
    if (outcome.kind === StepProcessOutcomeKind.Covered) {
        handleDoneOutcome(options, request, outcome.kind);
        return;
    }
    if (outcome.kind === StepProcessOutcomeKind.Finished) {
        handleDoneOutcome(options, request, outcome.kind);
        return;
    }
    if (outcome.kind === StepProcessOutcomeKind.Stopped) {
        if (isRepoWalkFinished(options, request.file)) {
            writeStatus(options, request.file, FileWalkStatus.Idle, undefined);
            return;
        }
        lastStopByFileValue.set(request.file.value, { file: request.file, eventType: outcome.eventType, source: outcome.source });
        if (outcome.eventType === FileEventType.ScriptMayWrite) {
            await handleScriptStop(options, playStartAtByFileValue, request, outcome.source);
            return;
        }
        // writeStatus(options, request.file, FileWalkStatus.Stopped, `stopped at ${outcome.eventType} ${outcome.source}: the engine stops here in every new process`);
        // writeStatus(options, request.file, FileWalkStatus.Stopped, `stopped at ${outcome.eventType} ${formatShortSource(outcome.source)}: the engine stops here in every new process`);
        writeStatus(options, request.file, FileWalkStatus.Stopped, describeRefusedStop(outcome.eventType, outcome.source));
        return;
    }
    writeStatus(options, request.file, FileWalkStatus.Crashed, describeCrash(outcome));
}

export function createHistoryWalker(options: HistoryWalkerOptions): HistoryWalker {
    const lastStopByFileValue = new Map<string, StoppedWalk>();
    const playStartAtByFileValue = new Map<string, Date>();
    return {
        walkHistoryTo: (currentTime, file, isVisible) => walkHistoryTo(options, currentTime, file, isVisible),
        handleOutcome: (request, outcome) => handleOutcome(options, lastStopByFileValue, playStartAtByFileValue, request, outcome),
        playScript: (file, startAt) => playScript(options, lastStopByFileValue, playStartAtByFileValue, file, startAt),
    };
}

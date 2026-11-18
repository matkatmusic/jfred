// The history walker of the terminal UI: spans check, outcome handling and stop rules.

import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus, PlayOutcomeKind, ScriptAction, StepProcessOutcomeKind } from "../../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3_replay_reverse_events.ts";
import { getInverseRepoFolderForFile } from "../engineV3_inverse_repos_for_project.ts";
import { isInstantSpannedByWalkCoverage, readWalkCoverage } from "../engineV3_walk_coverage.ts";
import { getFileRunState, setFileRunState, type FileRunState } from "./engineV3_tui_walk_state.ts";
import type { HistoryWalker, HistoryWalkerOptions, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";

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

async function handleScriptStop(options: HistoryWalkerOptions, request: StepRequest, source: string | null): Promise<void> {
    const stopText = `stopped at ${FileEventType.ScriptMayWrite} ${source}`;
    const scriptAction = options.decideScriptAction(request.file, FileEventType.ScriptMayWrite, source);
    if (scriptAction === ScriptAction.Refuse) {
        writeStatus(options, request.file, FileWalkStatus.Stopped, `${stopText}: scripts are not allowed in this session`);
        return;
    }
    if (scriptAction === ScriptAction.WaitForKey) {
        writeStatus(options, request.file, FileWalkStatus.Stopped, `${stopText}: press the play key`);
        return;
    }
    const playOutcome = await options.requestPlay({ file: request.file });
    if (playOutcome.kind === PlayOutcomeKind.Replayed) {
        writeStatus(options, request.file, FileWalkStatus.Idle, undefined);
        walkHistoryTo(options, request.startAt, request.file, IS_REWALK_VISIBLE);
        return;
    }
    if (playOutcome.kind === PlayOutcomeKind.ReplayRefused) {
        const previousRunState = getFileRunState(options.walkState, request.file);
        writeRunState(options, request.file, { status: FileWalkStatus.Stopped, reasonText: playOutcome.reasonText, failedReplayCount: previousRunState.failedReplayCount + 1 });
        return;
    }
    writeStatus(options, request.file, FileWalkStatus.Crashed, playOutcome.reasonText);
}

function describeCrash(outcome: Extract<StepProcessOutcome, { kind: StepProcessOutcomeKind.Crashed }>): string {
    let crashText = `process killed by signal ${outcome.signal}`;
    if (outcome.exitCode !== null) {
        crashText = `process exited with code ${outcome.exitCode}`;
    }
    if (outcome.crashedAt !== null) {
        crashText += ` at ${outcome.crashedAt.eventType} ${outcome.crashedAt.source}`;
    }
    return `${crashText}: ${outcome.stderrTail}`;
}

async function handleOutcome(options: HistoryWalkerOptions, request: StepRequest, outcome: StepProcessOutcome): Promise<void> {
    if (outcome.kind === StepProcessOutcomeKind.Covered) {
        handleDoneOutcome(options, request, outcome.kind);
        return;
    }
    if (outcome.kind === StepProcessOutcomeKind.Finished) {
        handleDoneOutcome(options, request, outcome.kind);
        return;
    }
    if (outcome.kind === StepProcessOutcomeKind.Stopped) {
        if (outcome.eventType === FileEventType.ScriptMayWrite) {
            await handleScriptStop(options, request, outcome.source);
            return;
        }
        writeStatus(options, request.file, FileWalkStatus.Stopped, `stopped at ${outcome.eventType} ${outcome.source}: the engine stops here in every new process`);
        return;
    }
    writeStatus(options, request.file, FileWalkStatus.Crashed, describeCrash(outcome));
}

export function createHistoryWalker(options: HistoryWalkerOptions): HistoryWalker {
    return {
        walkHistoryTo: (currentTime, file, isVisible) => walkHistoryTo(options, currentTime, file, isVisible),
        handleOutcome: (request, outcome) => handleOutcome(options, request, outcome),
    };
}

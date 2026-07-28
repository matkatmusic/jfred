// Script-execution replay: the reconstruction stage. Validates script execution by running the pre-script state through the actual script (in a temp dir) and comparing the result to the expected post-execution state derived from the file-history beacon. The memoized sandbox-run layer it builds on lives in reconstruction_script_runs.ts.

import { isImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";
import { beaconSnippetFor, type BeaconSnippet } from "./reconstruction_user_edit.ts";
import { backupSeedWriteFor, type BackupReader } from "./reconstruction_sidecar.ts";
import {
    findScriptExecutionRuns,
    type ScriptExecutionEvent,
    type ScriptRun,
} from "./reconstruction_script_execution.ts";
import type { LineageContentBefore } from "./reconstruction_script_prestate.ts";
import {
    executeRunOnce,
    selectRunsWithinReplayWindow,
} from "./reconstruction_script_runs.ts";
import { refForTarget, runForTarget } from "./reconstruction_script_probe.ts";
import { beaconlessScriptExecutions } from "./reconstruction_script_beaconless.ts";
import type { FileEvent, UserEditEvent } from "./reconstruction_engine.ts";

// Windowed forward test: whether `lines` reproduces every visible beacon line at its own (1-based) line number. The beacon may be a WINDOW, so only its shown lines are checked.
function linesMatchBeacon(lines: string[], snippet: BeaconSnippet): boolean {
    for (const { lineNo, text } of snippet.lines) {
        if (lineNo - 1 >= lines.length || lines[lineNo - 1] !== text) return false;
    }
    return true;
}

// The full file content at the beacon's observation time — the post-execution anchor.
function getPostExecutionBeacon(
    target: Path,
    beaconTimestamp: Date,
    records: TranscriptRecord[],
    reader: BackupReader,
): string | undefined {
    const backup = backupSeedWriteFor(records, target, beaconTimestamp, reader);
    return backup?.content;
}

// ponytail: identity — no scenarios have edits between script run and beacon; add rewind when needed
function getImmediatePostExecutionState(beaconContent: string): string {
    return beaconContent;
}

// The synthetic script-execution event for a validated beacon: the beacon's identity with the computed content and the run's timestamp.
function createScriptExecutionEvent(
    beacon: UserEditEvent,
    resultContent: string,
    run: ScriptRun,
): ScriptExecutionEvent {
    return {
        kind: EventKind.scriptExecution,
        changeId: beacon.changeId,
        target: beacon.target,
        content: resultContent,
        timestamp: run.timestamp,
    };
}

// The VALIDATE pipeline from Script-execution-algorithm.md (lines 33-47): for a user-edit beacon that is the echo of a script run, execute the script against the pre-execution state and compare to the expected post-execution state. On match, return a ScriptExecutionEvent carrying the computed content.
function scriptExecutionForBeacon(
    beacon: UserEditEvent,
    runs: ScriptRun[],
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): ScriptExecutionEvent | undefined {
    const run = runForTarget(runs, beacon.target, beacon.timestamp, records, reader, seedContent);
    if (run === undefined) return undefined;

    const execution = executeRunOnce(run, records, reader, seedContent);
    const preExecutionState = execution.pre;
    const resultingState = execution.post;
    if (resultingState === undefined) return undefined;

    const targetRef = refForTarget(beacon.target, [...preExecutionState.keys()]);
    if (targetRef === undefined) return undefined;

    const resultContent = resultingState.get(targetRef);
    if (resultContent === undefined) return undefined;

    // Guard: if the script didn't change this file, it's not a script-execution event
    const preContent = preExecutionState.get(targetRef);
    if (resultContent === preContent) return undefined;

    // VALIDATE: compare resultingState to expectedState Primary: full content match against beacon backup
    const beaconContent = getPostExecutionBeacon(beacon.target, beacon.timestamp, records, reader);
    if (beaconContent !== undefined) {
        const expectedState = getImmediatePostExecutionState(beaconContent);
        if (resultContent === expectedState) {
            return createScriptExecutionEvent(beacon, resultContent, run);
        }
    }
    // Fallback: windowed comparison (handles out-of-band changes between script and beacon)
    const snippet = beaconSnippetFor(records, beacon.changeId);
    if (snippet !== undefined && linesMatchBeacon(splitLines(resultContent), snippet)) {
        return {
            kind: EventKind.scriptExecution,
            changeId: beacon.changeId,
            target: beacon.target,
            content: resultContent,
            timestamp: run.timestamp,
        };
    }
    return undefined;
}

function noteInjection(event: ScriptExecutionEvent, detail: string): void {
    noteStage({
        stage: "injectScriptExecutions",
        target: event.target,
        changeId: event.changeId,
        detail,
        when: event.timestamp,
    });
}

function rebuiltEvent(
    event: FileEvent,
    runs: ScriptRun[],
    records: TranscriptRecord[],
    reader: BackupReader,
    seedContent?: LineageContentBefore,
): FileEvent {
    if (event.kind !== EventKind.userEdit) return event;
    const replacement = scriptExecutionForBeacon(event, runs, records, reader, seedContent);
    if (replacement === undefined) return event;
    noteInjection(replacement, "replaced a script-echo user-edit beacon with the validated forward transform");
    return replacement;
}

// Reconstruction stage: replace each user-edit beacon that is the validated echo of a script-execution run with a synthetic ScriptExecutionEvent, OR inject a new event when the script modified a file that has no beacon (multi-session transcripts where the baseline Write predates the script run).  Task 191: the stage announcement shows the replay-window count against the full pool ("script stage: 2559 of 2871 runs for <file>") so a watcher can see the window's ceiling.
export function formatScriptStageLabel(windowedCount: number, totalCount: number, target?: Path): string {
    const targetSuffix = target === undefined ? "" : ` for ${target}`;
    return `script stage: ${windowedCount} of ${totalCount} runs${targetSuffix}`;
}

export function injectScriptExecutions(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
    target?: Path,
    seedContent?: LineageContentBefore,
): FileEvent[] {
    if (!isImpureExecutionAllowed()) return events;
    const allRuns = findScriptExecutionRuns(records);
    const runs = selectRunsWithinReplayWindow(allRuns);
    if (runs.length === 0) return events;
    reportReconstructionProgress(formatScriptStageLabel(runs.length, allRuns.length, target));
    let anyReplaced = false;
    const result = events.map((event) => {
        const rebuilt = rebuiltEvent(event, runs, records, reader, seedContent);
        if (rebuilt !== event) anyReplaced = true;
        return rebuilt;
    });
    if (anyReplaced || target === undefined) return result;
    for (const injection of beaconlessScriptExecutions(target, runs, records, reader, seedContent)) {
        noteInjection(injection, "injected script-execution effect for a file with no user-edit beacon");
        const insertAt = result.findIndex((e) => e.timestamp > injection.timestamp);
        if (insertAt < 0) result.push(injection);
        else result.splice(insertAt, 0, injection);
    }
    return result;
}

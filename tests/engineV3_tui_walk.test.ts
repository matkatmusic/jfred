// The history walker of the terminal UI: spans check, outcome handling and stop rules.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, InverseStepOutcome, PlayOutcomeKind, ScriptAction, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { StepResultLine } from "../engineV3/engineV3_step_start_at.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { selectInverseCommitAtInstant } from "../engineV3/engineV3_inverse_repo_read.ts";
import { getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { WALK_COVERAGE_FILE_NAME, readWalkCoverage } from "../engineV3/engineV3_walk_coverage.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import { createSpawnStepProcess } from "../engineV3/tui/engineV3_tui_step_process.ts";
import { createWalkState, getFileRunState, type FileRunState, type WalkState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { HistoryWalker, HistoryWalkerOptions, PlayOutcome, SpawnSettings, StepPool, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { PROJECT_FILE_NAME, makeInstant, makeWriteCreateRows, writeProject } from "./engineV3_step_test_projects.ts";

const JFRED_FOLDER = new Path(join(import.meta.dirname, ".."));
const REAL_PROCESS_TIMEOUT_MILLISECONDS = 110000;
const MARKER_TIME = makeInstant(20);
const SOURCE_TEXT = "toolu_x";

type RequestedWalk = { request: StepRequest; isVisible: boolean };
type StatusChange = { file: Path; runState: FileRunState };
type Folders = { storeFolder: Path; projectFolder: Path };
type Harness = {
    file: Path;
    folders: Folders;
    walkState: WalkState;
    requestedWalks: RequestedWalk[];
    statusChanges: StatusChange[];
    walker: HistoryWalker;
};

function makeTemporaryFolders(t: TestContext): Folders {
    const rootFolder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-tui-walk-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    return { storeFolder: new Path(join(rootFolder, "store")), projectFolder: new Path(join(rootFolder, "project")) };
}

function throwBecauseNotExpected(): never {
    throw new Error("the walker called a function that this test does not expect");
}

function buildHarness(t: TestContext, overrides: Partial<HistoryWalkerOptions> = {}, folders: Folders = makeTemporaryFolders(t), file: Path = new Path(join(folders.projectFolder.toString(), PROJECT_FILE_NAME))): Harness {
    const walkState = createWalkState();
    const requestedWalks: RequestedWalk[] = [];
    const statusChanges: StatusChange[] = [];
    const options: HistoryWalkerOptions = {
        storeFolder: folders.storeFolder,
        projectFolder: folders.projectFolder,
        walkState,
        requestWalk: (request, isVisible) => {
            requestedWalks.push({ request, isVisible });
        },
        requestPlay: throwBecauseNotExpected,
        decideScriptAction: throwBecauseNotExpected,
        onStatusChange: (changedFile, runState) => {
            statusChanges.push({ file: changedFile, runState });
        },
        ...overrides,
    };
    return { file, folders, walkState, requestedWalks, statusChanges, walker: createHistoryWalker(options) };
}

// The sidecar the real child writes: the walk reaches down to tipInstant, or to the birth of the file.
function writeCoverageSidecar(harness: Harness, tipInstant: Date | null, isFinished: boolean): void {
    const repoFolder = getInverseRepoFolderForFile(harness.folders.storeFolder, harness.folders.projectFolder, harness.file);
    mkdirSync(repoFolder.toString(), { recursive: true });
    const tipInstantText = tipInstant === null ? null : tipInstant.toISOString();
    writeFileSync(join(repoFolder.toString(), WALK_COVERAGE_FILE_NAME), JSON.stringify({ tipInstant: tipInstantText, isFinished }));
}

function makeResultLine(outcome: InverseStepOutcome, eventType: FileEventType | null, source: string | null): StepResultLine {
    return { startAt: MARKER_TIME.toISOString(), outcome, commitsWritten: 0, position: 0, commit: "abc", eventType, source };
}

function makeRequest(harness: Harness): StepRequest {
    return { file: harness.file, startAt: MARKER_TIME, isPassingStops: false };
}

function makeCoveredOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Covered, lastLine: makeResultLine(InverseStepOutcome.StartAtReached, null, null) };
}

function makeFinishedOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Finished, lastLine: makeResultLine(InverseStepOutcome.NoOlderChange, null, null) };
}

function makeStoppedOutcome(eventType: FileEventType, source: string | null): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Stopped, eventType, source, lastLine: makeResultLine(InverseStepOutcome.UnknownOrRoadblock, eventType, source) };
}

function readRunState(harness: Harness): FileRunState {
    return getFileRunState(harness.walkState, harness.file);
}

function readReasonText(harness: Harness): string {
    const reasonText = readRunState(harness).reasonText;
    assert.notEqual(reasonText, undefined);
    return reasonText!;
}

function assertLastStatusChangeIsTheWalkState(harness: Harness): void {
    const lastStatusChange = harness.statusChanges[harness.statusChanges.length - 1];
    assert.notEqual(lastStatusChange, undefined);
    assert.equal(lastStatusChange!.file.toString(), harness.file.toString());
    assert.deepEqual(lastStatusChange!.runState, readRunState(harness));
}

test("test_walkHistoryTo_checks_out_without_spawning_when_the_repo_spans_the_time", (t) => {
    // Scenario: the stored commits reach down to second 10; the marker is at second 20.
    const harness = buildHarness(t);
    writeCoverageSidecar(harness, makeInstant(10), false);
    // Ask for the history at second 20.
    const isSpanned = harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true);
    // The answer is true and no walk was requested.
    assert.equal(isSpanned, true);
    assert.equal(harness.requestedWalks.length, 0);
});

test("test_walkHistoryTo_requests_a_walk_when_the_repo_has_no_coverage_file", (t) => {
    // Scenario: the repo folder does not exist yet.
    const harness = buildHarness(t);
    // Ask for the history at second 20, with a visible row.
    const isSpanned = harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true);
    // The answer is false and one walk request names the file, the marker time, no stop passing and the visible row.
    assert.equal(isSpanned, false);
    assert.equal(harness.requestedWalks.length, 1);
    assert.deepEqual(harness.requestedWalks[0]!.request, makeRequest(harness));
    assert.equal(harness.requestedWalks[0]!.isVisible, true);
});

test("test_walkHistoryTo_spawns_once_then_checks_out_after_the_process_covers_the_time", async (t) => {
    // Scenario: the first call requests a walk; the process stores commits down to second 10; the answer is Covered.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    const request = harness.requestedWalks[0]!.request;
    writeCoverageSidecar(harness, makeInstant(10), false);
    // Hand the answer to the walker.
    await harness.walker.handleOutcome(request, makeCoveredOutcome());
    // The file is Idle and the walker asked for no second walk.
    assert.equal(harness.requestedWalks.length, 1);
    assert.equal(readRunState(harness).status, FileWalkStatus.Idle);
    // The next call finds the time spanned.
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), true);
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_walkHistoryTo_does_not_respawn_after_finished", async (t) => {
    // Scenario: the first call requests a walk; the process walks to the birth of the file and answers Finished.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    const request = harness.requestedWalks[0]!.request;
    writeCoverageSidecar(harness, makeInstant(30), true);
    await harness.walker.handleOutcome(request, makeFinishedOutcome());
    // No new walk was requested and the file is Idle.
    assert.equal(harness.requestedWalks.length, 1);
    assert.equal(readRunState(harness).status, FileWalkStatus.Idle);
    // A later call, even for an older time, finds the time spanned.
    assert.equal(harness.walker.walkHistoryTo(makeInstant(1), harness.file, true), true);
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_walkHistoryTo_stops_at_a_script_stop_and_reports_the_source", async (t) => {
    // Scenario: the process stops at a script that may write; the session says to wait for the play key.
    const askedAbout: { file: Path; eventType: FileEventType; source: string | null }[] = [];
    const decideScriptAction: HistoryWalkerOptions["decideScriptAction"] = (file, eventType, source) => {
        askedAbout.push({ file, eventType, source });
        return ScriptAction.WaitForKey;
    };
    const harness = buildHarness(t, { decideScriptAction });
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    const request = harness.requestedWalks[0]!.request;
    await harness.walker.handleOutcome(request, makeStoppedOutcome(FileEventType.ScriptMayWrite, SOURCE_TEXT));
    // The walker asked what to do about this file, event type and source.
    assert.equal(askedAbout.length, 1);
    assert.equal(askedAbout[0]!.file.toString(), harness.file.toString());
    assert.equal(askedAbout[0]!.eventType, FileEventType.ScriptMayWrite);
    assert.equal(askedAbout[0]!.source, SOURCE_TEXT);
    // The file is Stopped, the text names the source, and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Stopped);
    assert.equal(readReasonText(harness), `stopped at ScriptMayWrite ${SOURCE_TEXT}: press the play key`);
    assert.equal(harness.requestedWalks.length, 1);
    assertLastStatusChangeIsTheWalkState(harness);
});

test("test_a_script_stop_says_scripts_are_not_allowed_when_the_session_refuses_scripts", async (t) => {
    // Scenario: the process stops at a script that may write; the session refuses scripts.
    const harness = buildHarness(t, { decideScriptAction: () => ScriptAction.Refuse });
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeStoppedOutcome(FileEventType.ScriptMayWrite, SOURCE_TEXT));
    // The file is Stopped with the refusal text and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Stopped);
    assert.equal(readReasonText(harness), `stopped at ScriptMayWrite ${SOURCE_TEXT}: scripts are not allowed in this session`);
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_a_non_script_stop_says_the_engine_stops_here_in_every_new_process", async (t) => {
    // Scenario: the process stops at an event that is not a script; decideScriptAction must not be asked.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeStoppedOutcome(FileEventType.RowBytesUnknown, SOURCE_TEXT));
    // The file is Stopped with the every-new-process text and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Stopped);
    assert.equal(readReasonText(harness), `stopped at RowBytesUnknown ${SOURCE_TEXT}: the engine stops here in every new process`);
    assert.equal(harness.requestedWalks.length, 1);
    assertLastStatusChangeIsTheWalkState(harness);
});

test("test_the_marker_walk_does_not_pass_a_stop", async (t) => {
    // Scenario: a normal walk request for the marker; the process stops at an event that is not a script.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    // The request does not pass stops.
    const request = harness.requestedWalks[0]!.request;
    assert.equal(request.isPassingStops, false);
    await harness.walker.handleOutcome(request, makeStoppedOutcome(FileEventType.RowBytesUnknown, SOURCE_TEXT));
    // The file is Stopped and the walker asked for no second walk.
    assert.equal(readRunState(harness).status, FileWalkStatus.Stopped);
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_a_script_stop_result_for_a_file_with_a_finished_walk_leaves_the_row_idle", async (t) => {
    // Scenario: the walk of the file is finished; a late child reports a script stop; the session runs scripts now.
    let playRequestCount = 0;
    const requestPlay: HistoryWalkerOptions["requestPlay"] = async () => {
        playRequestCount += 1;
        return { kind: PlayOutcomeKind.Replayed, reasonText: undefined };
    };
    const harness = buildHarness(t, { decideScriptAction: () => ScriptAction.RunNow, requestPlay });
    writeCoverageSidecar(harness, makeInstant(10), true);
    // The late stopped result arrives.
    await harness.walker.handleOutcome(makeRequest(harness), makeStoppedOutcome(FileEventType.ScriptMayWrite, SOURCE_TEXT));
    // The row is Idle with no reason text, and no play and no walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Idle);
    assert.equal(readRunState(harness).reasonText, undefined);
    assert.equal(playRequestCount, 0);
    assert.equal(harness.requestedWalks.length, 0);
});

test("test_a_non_script_stop_result_for_a_file_with_a_finished_walk_leaves_the_row_idle", async (t) => {
    // Scenario: the walk of the file is finished; a late child reports a stop at an event that is not a script.
    const harness = buildHarness(t);
    writeCoverageSidecar(harness, makeInstant(10), true);
    // The late stopped result arrives.
    await harness.walker.handleOutcome(makeRequest(harness), makeStoppedOutcome(FileEventType.RowBytesUnknown, SOURCE_TEXT));
    // The row is Idle with no reason text, and no walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Idle);
    assert.equal(readRunState(harness).reasonText, undefined);
    assert.equal(harness.requestedWalks.length, 0);
});

test("test_a_script_stop_result_for_a_file_with_an_unfinished_walk_still_marks_the_row_stopped", async (t) => {
    // Scenario: the walk of the file is not finished; a child reports a script stop; the session waits for the play key.
    const harness = buildHarness(t, { decideScriptAction: () => ScriptAction.WaitForKey });
    writeCoverageSidecar(harness, makeInstant(40), false);
    // The stopped result arrives.
    await harness.walker.handleOutcome(makeRequest(harness), makeStoppedOutcome(FileEventType.ScriptMayWrite, SOURCE_TEXT));
    // The row is Stopped with the play key text, and no walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Stopped);
    assert.equal(readReasonText(harness), `stopped at ScriptMayWrite ${SOURCE_TEXT}: press the play key`);
    assert.equal(harness.requestedWalks.length, 0);
});

test("test_walkHistoryTo_stops_at_a_crash_and_does_not_respawn", async (t) => {
    // Scenario: the process exits with code 1 at an Edit row and prints an error line.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    const crashedOutcome: StepProcessOutcome = {
        kind: StepProcessOutcomeKind.Crashed,
        exitCode: 1,
        signal: null,
        crashedAt: { nextEventIndex: 3, eventType: FileEventType.EditRow, source: SOURCE_TEXT },
        stderrTail: "boom in the engine",
    };
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, crashedOutcome);
    // The file is Crashed, the text holds the exit code, the event type, the source and the error line, and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Crashed);
    const reasonText = readReasonText(harness);
    assert.ok(reasonText.includes("1"), reasonText);
    assert.ok(reasonText.includes("EditRow"), reasonText);
    assert.ok(reasonText.includes(SOURCE_TEXT), reasonText);
    assert.ok(reasonText.includes("boom in the engine"), reasonText);
    assert.equal(harness.requestedWalks.length, 1);
    assertLastStatusChangeIsTheWalkState(harness);
});

test("test_a_child_killed_by_a_signal_marks_the_file_crashed_with_the_signal", async (t) => {
    // Scenario: the child dies from SIGKILL, so it has no exit code and no crashedAt.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    const crashedOutcome: StepProcessOutcome = { kind: StepProcessOutcomeKind.Crashed, exitCode: null, signal: "SIGKILL", crashedAt: null, stderrTail: "last words" };
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, crashedOutcome);
    // The file is Crashed and the text holds the signal and the error line.
    assert.equal(readRunState(harness).status, FileWalkStatus.Crashed);
    assert.ok(readReasonText(harness).includes("SIGKILL"));
    assert.ok(readReasonText(harness).includes("last words"));
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_walkHistoryTo_marks_a_file_crashed_when_a_done_process_left_the_time_uncovered", async (t) => {
    // Scenario: the process answers Finished but the sidecar does not exist.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeFinishedOutcome());
    // The file is Crashed with the guard text and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Crashed);
    assert.equal(readReasonText(harness), `walk reported done but the coverage does not reach ${MARKER_TIME.toISOString()}`);
    assert.equal(harness.requestedWalks.length, 1);
    assertLastStatusChangeIsTheWalkState(harness);
});

test("test_walkHistoryTo_marks_a_file_crashed_when_a_covered_process_left_the_time_uncovered", async (t) => {
    // Scenario: the process answers Covered but its sidecar still stops at second 40, newer than the marker at second 20.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    writeCoverageSidecar(harness, makeInstant(40), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeCoveredOutcome());
    // The file is Crashed with the guard text and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Crashed);
    assert.equal(readReasonText(harness), `walk reported done but the coverage does not reach ${MARKER_TIME.toISOString()}`);
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_walkHistoryTo_calls_itself_again_after_a_commit_was_added", async (t) => {
    // Scenario: the process answers start-at-reached after it wrote a commit; the sidecar now reaches second 10.
    const harness = buildHarness(t);
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    writeCoverageSidecar(harness, makeInstant(10), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeCoveredOutcome());
    // The file is Idle with no reason text, the status change was announced, and the repeated call found the time spanned.
    assert.equal(readRunState(harness).status, FileWalkStatus.Idle);
    assert.equal(readRunState(harness).reasonText, undefined);
    assertLastStatusChangeIsTheWalkState(harness);
    assert.equal(harness.requestedWalks.length, 1);
});

test("test_walkHistoryTo_runs_the_replay_when_the_session_runs_scripts_now_and_walks_again_after_it", async (t) => {
    // Scenario: a script stop with RunNow; the replay adds commits but the sidecar still stops at second 40, newer than the marker.
    const playRequests: { file: Path }[] = [];
    const requestPlay = async (playRequest: { file: Path }): Promise<PlayOutcome> => {
        playRequests.push(playRequest);
        return { kind: PlayOutcomeKind.Replayed, reasonText: undefined };
    };
    const harness = buildHarness(t, { decideScriptAction: () => ScriptAction.RunNow, requestPlay });
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    writeCoverageSidecar(harness, makeInstant(40), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeStoppedOutcome(FileEventType.ScriptMayWrite, SOURCE_TEXT));
    // The play request named the file.
    assert.equal(playRequests.length, 1);
    assert.equal(playRequests[0]!.file.toString(), harness.file.toString());
    // After the replay the walker called walkHistoryTo again: the time is not spanned, so a second walk was requested.
    assert.equal(harness.requestedWalks.length, 2);
    assert.deepEqual(harness.requestedWalks[1]!.request, makeRequest(harness));
});

test("test_walkHistoryTo_stays_stopped_after_a_refused_script_replay_and_does_not_respawn", async (t) => {
    // Scenario: a script stop with RunNow; the replay is refused with a reason.
    const refusalReason = "the repo of b.txt is not walked to its end";
    const requestPlay = async (): Promise<PlayOutcome> => ({ kind: PlayOutcomeKind.ReplayRefused, reasonText: refusalReason });
    const harness = buildHarness(t, { decideScriptAction: () => ScriptAction.RunNow, requestPlay });
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, makeStoppedOutcome(FileEventType.ScriptMayWrite, SOURCE_TEXT));
    // The file stays Stopped, the reason is the play reason, the failed replay count is 1, and no new walk was requested.
    assert.equal(readRunState(harness).status, FileWalkStatus.Stopped);
    assert.equal(readReasonText(harness), refusalReason);
    assert.equal(readRunState(harness).failedReplayCount, 1);
    assert.equal(harness.requestedWalks.length, 1);
    assertLastStatusChangeIsTheWalkState(harness);
});

test("test_the_answer_of_a_cancelled_child_is_dropped", async (t) => {
    // Scenario: the real pool holds a walk child open; the file is cancelled; then the child answers Covered.
    let pool: StepPool | undefined;
    let spawnCount = 0;
    let handledOutcomeCount = 0;
    let markSpawned: () => void = throwBecauseNotExpected;
    const spawned = new Promise<void>((resolve) => {
        markSpawned = resolve;
    });
    let releaseChild: () => void = throwBecauseNotExpected;
    let markChildExited: () => void = throwBecauseNotExpected;
    const childExited = new Promise<void>((resolve) => {
        markChildExited = resolve;
    });
    const spawnStepProcess = (): Promise<StepProcessOutcome> => {
        spawnCount++;
        markSpawned();
        return new Promise<StepProcessOutcome>((resolve) => {
            releaseChild = () => {
                resolve(makeCoveredOutcome());
                markChildExited();
            };
        });
    };
    const harness = buildHarness(t, { requestWalk: (request, isVisible) => pool!.requestWalk(request, isVisible) });
    pool = createStepPool({
        maxProcesses: 1,
        spawnStepProcess,
        spawnPlayProcess: throwBecauseNotExpected,
        onOutcome: (request: StepRequest, outcome: StepProcessOutcome) => {
            handledOutcomeCount++;
            void harness.walker.handleOutcome(request, outcome);
        },
        onStatusChange: () => {},
        isFileWalkFinished: () => false,
        isFileSteppable: () => true,
        hasLogsGrown: () => false,
        onLogsGrew: throwBecauseNotExpected,
        endChildOfFile: async () => {
            await childExited;
        },
        endAllChildren: throwBecauseNotExpected,
    });
    assert.equal(harness.walker.walkHistoryTo(MARKER_TIME, harness.file, true), false);
    await spawned;
    if (pool === undefined) {
        throw new Error("pool missing");
    }
    // Cancel the file while the child runs, then let the child answer.
    const cancelling = pool.cancelFile(harness.file);
    releaseChild();
    await cancelling;
    await pool.waitUntilIdle();
    // The walker never saw the answer: no status was written, no status change was announced, and no second child started.
    assert.equal(handledOutcomeCount, 0);
    assert.equal(harness.walkState.getRunState(harness.file), undefined);
    assert.equal(harness.statusChanges.length, 0);
    assert.equal(spawnCount, 1);
});

test("test_a_file_born_after_the_time_is_finished_spans_the_time_and_is_not_respawned", { timeout: REAL_PROCESS_TIMEOUT_MILLISECONDS }, async (t) => {
    // Scenario: a made-up project where a.txt is created by a Write at second 30; the marker is at second 10, before the birth.
    const project = writeProject(t, "hello\n", (projectFolder, filePath) => makeWriteCreateRows(projectFolder, "toolu_w1", filePath, "hello\n", 30));
    const settings: SpawnSettings = {
        projectFolder: project.projectFolder,
        jsonlsFolders: [project.jsonlsFolder],
        fileHistoryFolders: [project.snapshotFolder],
        storeFolder: project.storeFolder,
        earliestBoundary: undefined,
        jfredFolder: JFRED_FOLDER,
    };
    const markerTime = makeInstant(10);
    const harness = buildHarness(t, {}, { storeFolder: project.storeFolder, projectFolder: project.projectFolder }, project.file);
    // The first call finds no repo and requests one walk.
    assert.equal(harness.walker.walkHistoryTo(markerTime, project.file, true), false);
    assert.equal(harness.requestedWalks.length, 1);
    // Run the requested walk with the real child process.
    const outcome = await createSpawnStepProcess(settings)(harness.requestedWalks[0]!.request);
    assert.equal(outcome.kind, StepProcessOutcomeKind.Finished);
    await harness.walker.handleOutcome(harness.requestedWalks[0]!.request, outcome);
    // The sidecar says finished.
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    assert.equal(readWalkCoverage(repoFolder)?.isFinished, true);
    // The file is Idle, and the second call returns true with zero further requests.
    assert.equal(readRunState(harness).status, FileWalkStatus.Idle);
    assert.equal(harness.walker.walkHistoryTo(markerTime, project.file, true), true);
    assert.equal(harness.requestedWalks.length, 1);
    // No stored commit holds a state at second 10: the row says "did not exist yet".
    const storedCommits = listInverseCommits(repoFolder, PROJECT_FILE_NAME, false);
    assert.equal(selectInverseCommitAtInstant(storedCommits, markerTime), undefined);
});

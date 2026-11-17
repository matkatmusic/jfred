import { test } from "node:test";
import assert from "node:assert/strict";

import { Path, Uuid } from "../src/structures/domain.ts";
import { ToolName, StopGapKind } from "../src/structures/vocabulary.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { StateConfidence, StateMoment } from "../engineV3/engineV3_file_known_states.ts";
import type { InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { FileEventType, createEvent, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { ScriptReplayTaskReason } from "../engineV3/engineV3_script_replay_tasks.ts";
import { findStopGap, type StopGap } from "../engineV3/engineV3_step_replay_gap.ts";

const JSONL_PATH = "/logs/session.jsonl";
const PROJECT_FOLDER = new Path("/project");
const RELATIVE_PATH = "f.txt";

type FoundStopGap = Extract<StopGap, { kind: StopGapKind.Found }>;

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeSource(line: number): { filePath: string; lineNumber: number } {
    return { filePath: JSONL_PATH, lineNumber: line };
}

function makeDiskNowEvent(text: string): FileEvent {
    return createEvent(FileEventType.DiskNow, undefined, undefined, { bytes: text });
}

function makeWriteEvent(second: number, content: string): FileEvent {
    const row = { toolName: ToolName.Write as const, timestamp: makeInstant(second), source: makeSource(second), isCreate: true, content, originalFile: undefined };
    return createEvent(FileEventType.WriteRow, makeInstant(second), makeSource(second), { row });
}

function makeEditEvent(second: number, oldString: string, newString: string): FileEvent {
    const row = { toolName: ToolName.Edit as const, timestamp: makeInstant(second), source: makeSource(second), oldString, newString, replaceAll: false, originalFile: undefined };
    return createEvent(FileEventType.EditRow, makeInstant(second), makeSource(second), { row });
}

function makeScriptEvent(second: number, overrides: Partial<ScriptRun> = {}): FileEvent {
    const scriptRun: ScriptRun = {
        code: "printf 'v1\\n' > f.txt",
        timestamp: makeInstant(second),
        cwd: PROJECT_FOLDER,
        source: makeSource(second),
        toolUseId: new Uuid(`toolu_${second}`),
        executorKind: ScriptExecutorKind.bash,
        runInBackground: false,
        ...overrides,
    };
    return createEvent(FileEventType.ScriptMayWrite, makeInstant(second), makeSource(second), { scriptRun });
}

function makeStoredCommit(position: number): InverseCommit {
    return {
        commitHash: new Uuid("0".repeat(40)),
        treeHash: new Uuid("1".repeat(40)),
        position,
        eventType: FileEventType.DiskNow,
        moment: StateMoment.AtEvent,
        confidence: StateConfidence.Proven,
        instant: undefined,
        jsonlPath: undefined,
        line: undefined,
        isFileAbsent: false,
        removedByScript: false,
        movedAwayToFile: undefined,
        text: "v1\n",
    };
}

function findStopGapAtSecond(events: FileEvent[], stopSecond: number, tipPosition: number = 0): StopGap {
    return findStopGap(events, [makeStoredCommit(tipPosition)], makeSource(stopSecond), PROJECT_FOLDER, RELATIVE_PATH);
}

function expectFound(result: StopGap): FoundStopGap {
    assert.equal(result.kind, StopGapKind.Found);
    return result as FoundStopGap;
}

function expectRefusalReasonToContain(result: StopGap, expectedText: string): void {
    assert.equal(result.kind, StopGapKind.Refused);
    assert.ok((result as { reason: string }).reason.includes(expectedText), `reason was: ${(result as { reason: string }).reason}`);
}

test("test_a_script_stop_whose_older_whole_text_differs_gives_the_gap_the_start_text_and_one_task", () => {
    // Scenario: disk "v1\n", a script at 20, an Edit at 15, a Write of "v0\n" at 10.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(20), makeEditEvent(15, "zz", "v1"), makeWriteEvent(10, "v0\n")];
    // The stop is on the script.
    const found = expectFound(findStopGapAtSecond(events, 20));
    // The gap drops positions 1, 2 and 3 and ends at older position 4.
    assert.deepEqual(found.gap.droppedStates.map((droppedState) => droppedState.position), [1, 2, 3]);
    assert.equal(found.gap.olderPosition, 4);
    // The start text is the older whole text.
    assert.equal(found.startText, "v0\n");
    // One task, waiting for the file by name.
    assert.equal(found.tasks.length, 1);
    assert.deepEqual(found.tasks[0]!.waitingFiles, [{ relativePath: RELATIVE_PATH, reason: ScriptReplayTaskReason.NamedByFile }]);
});

test("test_a_stop_whose_older_whole_text_equals_the_carried_text_is_refused_because_nothing_is_left_to_fill", () => {
    // Scenario: the older Write has the same text as the disk, so the script state is confirmed.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(20), makeWriteEvent(10, "v1\n")];
    // The refusal says the script left nothing to fill.
    expectRefusalReasonToContain(findStopGapAtSecond(events, 20), "left nothing to fill");
});

test("test_a_gap_that_reaches_the_history_start_is_refused", () => {
    // Scenario: disk, then a script, and nothing older.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(20)];
    // The refusal says the gap reaches the start of the history.
    expectRefusalReasonToContain(findStopGapAtSecond(events, 20), "start of the history");
});

// test_a_gap_with_a_user_edit_notice_is_refused: not buildable. A UserEditNotice state is never Unknown, so no gap can hold one.

test("test_a_javascript_script_is_refused_with_the_refusal_text_of_the_run_module", () => {
    // Scenario: the script in the gap runs a .js file.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(20, { invokedScriptPath: "build.js" }), makeWriteEvent(10, "v0\n")];
    // The refusal names the task and the JavaScript reason.
    expectRefusalReasonToContain(findStopGapAtSecond(events, 20), "build.js is JavaScript or TypeScript");
});

test("test_a_background_script_is_refused", () => {
    // Scenario: the script in the gap runs in the background.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(20, { runInBackground: true }), makeWriteEvent(10, "v0\n")];
    // The refusal says the script runs in the background.
    expectRefusalReasonToContain(findStopGapAtSecond(events, 20), "runs in the background");
});

test("test_a_gap_with_two_scripts_gives_two_tasks_oldest_instant_first", () => {
    // Scenario: two scripts, at 30 and 20, in one gap.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(30), makeScriptEvent(20), makeWriteEvent(10, "v0\n")];
    // The stop is on the newer script.
    const found = expectFound(findStopGapAtSecond(events, 30));
    // Two tasks: the script at 20 first, then the script at 30.
    assert.deepEqual(found.tasks.map((task) => task.instant.getTime()), [makeInstant(20).getTime(), makeInstant(30).getTime()]);
});

test("test_a_dropped_position_at_or_below_the_tip_is_refused", () => {
    // Scenario: the fixture of the first test, with a stored commit at position 2.
    const events = [makeDiskNowEvent("v1\n"), makeScriptEvent(20), makeEditEvent(15, "zz", "v1"), makeWriteEvent(10, "v0\n")];
    // The refusal says a position of the gap already has a commit.
    expectRefusalReasonToContain(findStopGapAtSecond(events, 20, 2), "already has a commit");
});

test("test_a_half_dropped_gap_is_refused", () => {
    // Scenario: an Edit that fits neither way, then a script, then a Write.
    const events = [makeDiskNowEvent("v1\n"), makeEditEvent(30, "qq", "rr"), makeScriptEvent(20), makeWriteEvent(10, "v0\n")];
    // The stop is on the script. The gap starts at the Edit's before state.
    expectRefusalReasonToContain(findStopGapAtSecond(events, 20), "half dropped");
});

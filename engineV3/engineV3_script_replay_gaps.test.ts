import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits, type InverseCommit, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import {
    ReplayGapKind, buildReplayGapsSidecar, convertScriptRunToTaskRecord, convertTaskRecordToScriptRun, isGapHalfDropped,
    isReplayGapsSidecarPresent, listReplayGapsFromStates, listUnfilledGapRecords, listUnfilledScriptGapsAtInstant,
    readReplayGapsSidecar, writeReplayGapsSidecar,
    type ReplayGap, type ReplayGapRecord, type ReplayGapsSidecar, type ScriptReplayTaskRecord,
} from "./engineV3_script_replay_gaps.ts";

const FILE_NAME = "a.txt";
const JSONL_PATH = "/logs/session.jsonl";

function makeTempFolder(t: TestContext): Path {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-script-replay-gaps-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return new Path(folder);
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeScriptRun(second: number, line: number): ScriptRun {
    return {
        code: `print(${line})`,
        timestamp: makeInstant(second),
        cwd: new Path("/project"),
        source: { filePath: JSONL_PATH, lineNumber: line },
        toolUseId: new Uuid(`toolu_${line}`),
        executorKind: ScriptExecutorKind.python,
        language: "python",
        invokedScriptPath: "move.py",
        runInBackground: false,
    };
}

function makeEvent(type: FileEventType, second: number | undefined, line: number | undefined, overrides: Partial<FileEvent> = {}): FileEvent {
    let instant: Date | undefined;
    if (second !== undefined) {
        instant = makeInstant(second);
    }
    let source: FileEvent["source"];
    if (line !== undefined) {
        source = { filePath: JSONL_PATH, lineNumber: line };
    }
    return { type, instant, source, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined, ...overrides };
}

function makeScriptEvent(second: number, line: number): FileEvent {
    return makeEvent(FileEventType.ScriptMayWrite, second, line, { scriptRun: makeScriptRun(second, line) });
}

function makeState(event: FileEvent, confidence: StateConfidence, text: string | undefined, moment: StateMoment = StateMoment.AtEvent): FileKnownState {
    return { event, moment, confidence, isFileAbsent: false, text };
}

function makeDiskNowState(): FileKnownState {
    return makeState(makeEvent(FileEventType.DiskNow, undefined, undefined), StateConfidence.Proven, "now");
}

function makeWriteState(second: number, line: number): FileKnownState {
    return makeState(makeEvent(FileEventType.WriteRow, second, line), StateConfidence.Proven, `write ${line}`);
}

function makeDroppedScriptState(second: number, line: number): FileKnownState {
    return makeState(makeScriptEvent(second, line), StateConfidence.Unknown, undefined);
}

function makeDroppedEditState(second: number, line: number): FileKnownState {
    return makeState(makeEvent(FileEventType.EditRow, second, line), StateConfidence.Unknown, undefined);
}

function makeTaskRecord(second: number, line: number): ScriptReplayTaskRecord {
    return convertScriptRunToTaskRecord(makeScriptRun(second, line));
}

function makeGapRecord(newerPosition: number, olderPosition: number | null, droppedPositions: number[], scriptTasks: ScriptReplayTaskRecord[]): ReplayGapRecord {
    return { newerPosition, olderPosition, droppedPositions, scriptTasks };
}

function makeEmptySidecar(gaps: ReplayGapRecord[]): ReplayGapsSidecar {
    return { gaps, bornless: null };
}

function makeOrderedGitState(position: number, second: number): OrderedKnownState {
    const event = makeEvent(FileEventType.GitCommit, second, position);
    return { state: makeState(event, StateConfidence.Proven, `text ${position}`), position };
}

function makeInverseCommit(overrides: Partial<InverseCommit>): InverseCommit {
    return {
        commitHash: new Uuid("0".repeat(40)),
        position: 1,
        eventType: FileEventType.ScriptMayWrite,
        moment: StateMoment.AtEvent,
        confidence: StateConfidence.Proven,
        instant: makeInstant(10),
        jsonlPath: new Path(JSONL_PATH),
        line: 5,
        isFileAbsent: false,
        removedByScript: false,
        movedAwayToFile: undefined,
        text: "text",
        ...overrides,
    };
}

function makeGapOfDroppedState(droppedState: FileKnownState): ReplayGap {
    return { kind: ReplayGapKind.Dropped, newerPosition: 1, olderPosition: 3, droppedStates: [{ state: droppedState, position: 2 }] };
}

function makeRepoWithCommitsAtPositions(t: TestContext, positionsWithSeconds: [number, number][]): Path {
    const repoFolder = makeTempFolder(t);
    createInverseRepo(repoFolder, FILE_NAME, { state: makeDiskNowState(), position: 0 }, makeInstant(1000));
    const olderStates = positionsWithSeconds.map(([position, second]) => makeOrderedGitState(position, second));
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, olderStates);
    return repoFolder;
}

test("test_gap_is_a_maximal_run_of_unknown_states", () => {
    // Scenario: two separate runs of dropped states give two gaps; a run keeps a dropped state that is not a script.
    // Steps: states at 1 (script) and 2 (edit) are dropped, 3 is known, 4 (script) is dropped, 5 is known.
    const states = [
        makeDiskNowState(),
        makeDroppedScriptState(50, 11),
        makeDroppedEditState(40, 12),
        makeWriteState(30, 13),
        makeDroppedScriptState(20, 14),
        makeWriteState(10, 15),
    ];
    // The function returns two gaps.
    const gaps = listReplayGapsFromStates(states);
    assert.equal(gaps.length, 2);
    // The first gap holds positions 1 and 2, with the known states at 0 and 3 around it.
    assert.equal(gaps[0]!.kind, ReplayGapKind.Dropped);
    assert.equal(gaps[0]!.newerPosition, 0);
    assert.equal(gaps[0]!.olderPosition, 3);
    assert.deepEqual(gaps[0]!.droppedStates.map((orderedState) => orderedState.position), [1, 2]);
    // The second gap holds position 4, with the known states at 3 and 5 around it.
    assert.equal(gaps[1]!.newerPosition, 3);
    assert.equal(gaps[1]!.olderPosition, 5);
    assert.deepEqual(gaps[1]!.droppedStates.map((orderedState) => orderedState.position), [4]);
});

test("test_gap_without_a_script_event_is_ignored", () => {
    // Scenario: a run of dropped states with no ScriptMayWrite event is not a script gap.
    // Steps: states at 1 and 2 are dropped edits.
    const states = [makeDiskNowState(), makeDroppedEditState(50, 11), makeDroppedEditState(40, 12), makeWriteState(30, 13)];
    // The function returns no gap.
    assert.deepEqual(listReplayGapsFromStates(states), []);
});

test("test_gap_ending_at_the_oldest_state_has_no_older_position", () => {
    // Scenario: a run that reaches the oldest state has an undefined older position, and its oldest dropped event is not a script.
    // Steps: states at 1 (script) and 2 (edit, the oldest) are dropped.
    const states = [makeDiskNowState(), makeDroppedScriptState(50, 11), makeDroppedEditState(40, 12)];
    // The function returns one gap with an undefined older position.
    const gaps = listReplayGapsFromStates(states);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.newerPosition, 0);
    assert.equal(gaps[0]!.olderPosition, undefined);
    // The oldest dropped event is an edit, so no made-up state is added.
    assert.deepEqual(gaps[0]!.droppedStates.map((orderedState) => orderedState.position), [1, 2]);
});

test("test_history_end_script_gap_gets_a_made_up_before_state", () => {
    // Scenario: a script that is the oldest event with only an AtEvent state gets a made-up BeforeEvent state.
    // Steps: the state at 2 (the oldest) is a dropped script AtEvent state.
    const scriptState = makeDroppedScriptState(40, 12);
    const states = [makeDiskNowState(), makeWriteState(50, 11), scriptState];
    // The function returns one gap.
    const gaps = listReplayGapsFromStates(states);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.newerPosition, 1);
    assert.equal(gaps[0]!.olderPosition, undefined);
    // The gap holds position 2 and a made-up position 3.
    assert.deepEqual(gaps[0]!.droppedStates.map((orderedState) => orderedState.position), [2, 3]);
    // The made-up state is a dropped BeforeEvent state of the same event, with no text.
    const madeUpState = gaps[0]!.droppedStates[1]!.state;
    assert.equal(madeUpState.event, scriptState.event);
    assert.equal(madeUpState.moment, StateMoment.BeforeEvent);
    assert.equal(madeUpState.confidence, StateConfidence.Unknown);
    assert.equal(madeUpState.isFileAbsent, false);
    assert.equal(madeUpState.text, undefined);
});

test("test_history_end_gap_with_both_states_gets_no_extra_state", () => {
    // Scenario: when the oldest script event already has an AtEvent state and a BeforeEvent state, nothing is made up.
    // Steps: the states at 2 and 3 are both dropped states of one script event.
    const scriptEvent = makeScriptEvent(40, 12);
    const states = [
        makeDiskNowState(),
        makeWriteState(50, 11),
        makeState(scriptEvent, StateConfidence.Unknown, undefined, StateMoment.AtEvent),
        makeState(scriptEvent, StateConfidence.Unknown, undefined, StateMoment.BeforeEvent),
    ];
    // The function returns one gap with the two existing positions only.
    const gaps = listReplayGapsFromStates(states);
    assert.equal(gaps.length, 1);
    assert.deepEqual(gaps[0]!.droppedStates.map((orderedState) => orderedState.position), [2, 3]);
});

test("test_bornless_record_is_set_for_a_file_with_log_events_and_no_absent_state", () => {
    // Scenario: a file with log events, no absent state and no history-end gap gets a bornless record.
    // Steps: three known states; the oldest one is at second 30, line 13.
    const states = [makeDiskNowState(), makeWriteState(50, 11), makeWriteState(30, 13)];
    // The sidecar has no gap.
    const sidecar = buildReplayGapsSidecar(states);
    assert.deepEqual(sidecar.gaps, []);
    // The bornless record names the next free position and the oldest event.
    assert.deepEqual(sidecar.bornless, { nextFreePosition: 3, oldestInstant: makeInstant(30).toISOString(), oldestJsonlPath: JSONL_PATH });
});

test("test_bornless_record_is_null_when_a_history_end_gap_exists", () => {
    // Scenario: a file whose oldest state is a dropped script state has a history-end gap and no bornless record.
    // Steps: the state at 2 (the oldest) is a dropped script state.
    const states = [makeDiskNowState(), makeWriteState(50, 11), makeDroppedScriptState(40, 12)];
    // The sidecar has one gap and no bornless record.
    const sidecar = buildReplayGapsSidecar(states);
    assert.equal(sidecar.gaps.length, 1);
    assert.equal(sidecar.gaps[0]!.olderPosition, null);
    assert.deepEqual(sidecar.gaps[0]!.droppedPositions, [2, 3]);
    assert.equal(sidecar.gaps[0]!.scriptTasks.length, 1);
    assert.equal(sidecar.gaps[0]!.scriptTasks[0]!.taskId, `${JSONL_PATH}:12:toolu_12`);
    assert.equal(sidecar.bornless, null);
});

test("test_sidecar_round_trip_keeps_every_field", (t) => {
    // Scenario: a sidecar that is written and read again is equal to the original.
    // Steps: the sidecar has a gap with an older position, a history-end gap and a bornless record.
    const repoFolder = makeTempFolder(t);
    const sidecar: ReplayGapsSidecar = {
        gaps: [
            makeGapRecord(1, 4, [2, 3], [makeTaskRecord(20, 12), makeTaskRecord(25, 13)]),
            makeGapRecord(5, null, [6, 7], [makeTaskRecord(5, 14)]),
        ],
        bornless: { nextFreePosition: 8, oldestInstant: makeInstant(1).toISOString(), oldestJsonlPath: JSONL_PATH },
    };
    // Before the write, the sidecar is not present.
    assert.equal(isReplayGapsSidecarPresent(repoFolder), false);
    // After the write, the sidecar is present and the read gives an equal value.
    writeReplayGapsSidecar(repoFolder, sidecar);
    assert.equal(isReplayGapsSidecarPresent(repoFolder), true);
    assert.deepEqual(readReplayGapsSidecar(repoFolder), sidecar);
});

test("test_gap_record_is_filled_when_every_dropped_position_has_a_commit", (t) => {
    // Scenario: a gap record is listed as unfilled until every dropped position has a commit.
    // Steps: a repo has commits at positions 0, 1 and 4; the gap record drops positions 2 and 3.
    const repoFolder = makeRepoWithCommitsAtPositions(t, [[1, 100], [4, 10]]);
    const sidecar = makeEmptySidecar([makeGapRecord(1, 4, [2, 3], [makeTaskRecord(50, 12)])]);
    const readStoredPositions = () => new Set(listInverseCommits(repoFolder, FILE_NAME).map((inverseCommit) => inverseCommit.position));
    // With positions 0, 1 and 4 stored, the record is unfilled.
    assert.equal(listUnfilledGapRecords(sidecar, readStoredPositions()).length, 1);
    // With only position 2 added, the record is still unfilled.
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [makeOrderedGitState(2, 60)]);
    assert.equal(listUnfilledGapRecords(sidecar, readStoredPositions()).length, 1);
    // With position 3 added too, the record is filled.
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [makeOrderedGitState(3, 55)]);
    assert.deepEqual(listUnfilledGapRecords(sidecar, readStoredPositions()), []);
});

test("test_unfilled_script_gap_covers_instants_from_first_script_to_newer_commit", (t) => {
    // Scenario: an unfilled script gap is returned for an instant from the first script up to, but not including, the newer commit.
    // Steps: the newer commit (position 1) is at second 100, the older commit (position 4) at second 10, the first script at second 50.
    const repoFolder = makeRepoWithCommitsAtPositions(t, [[1, 100], [4, 10]]);
    writeReplayGapsSidecar(repoFolder, makeEmptySidecar([makeGapRecord(1, 4, [2, 3], [makeTaskRecord(70, 13), makeTaskRecord(50, 12)])]));
    // One second before the first script, no gap is returned.
    assert.deepEqual(listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(49)), []);
    // Exactly at the first script, the gap is returned with both commits.
    const gapsAtFirstScript = listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(50));
    assert.equal(gapsAtFirstScript.length, 1);
    assert.equal(gapsAtFirstScript[0]!.firstScriptInstant.getTime(), makeInstant(50).getTime());
    assert.equal(gapsAtFirstScript[0]!.newerCommit.position, 1);
    assert.equal(gapsAtFirstScript[0]!.olderCommit!.position, 4);
    // One second before the newer commit, the gap is returned.
    assert.equal(listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(99)).length, 1);
    // Exactly at the newer commit, no gap is returned.
    assert.deepEqual(listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(100)), []);
});

test("test_unfilled_script_gap_under_disk_now_covers_every_later_instant", (t) => {
    // Scenario: a gap right under the disk-now commit has no newer bound, so it covers every instant from the first script on.
    // Steps: the newer commit is the disk-now commit (position 0, no instant); the older commit (position 3) is at second 10; the first script is at second 50.
    const repoFolder = makeRepoWithCommitsAtPositions(t, [[3, 10]]);
    writeReplayGapsSidecar(repoFolder, makeEmptySidecar([makeGapRecord(0, 3, [1, 2], [makeTaskRecord(50, 12)])]));
    // One second before the first script, no gap is returned.
    assert.deepEqual(listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(49)), []);
    // Exactly at the first script, the gap is returned with the disk-now commit as the newer commit.
    const gapsAtFirstScript = listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(50));
    assert.equal(gapsAtFirstScript.length, 1);
    assert.equal(gapsAtFirstScript[0]!.newerCommit.eventType, FileEventType.DiskNow);
    // A long time after the first script, the gap is still returned.
    assert.equal(listUnfilledScriptGapsAtInstant(repoFolder, FILE_NAME, makeInstant(1000000)).length, 1);
});

test("test_bornless_record_is_null_when_a_history_end_gap_without_a_script_exists", () => {
    // Scenario: a history-end run of dropped states with no script event still makes the bornless record null.
    // Steps: the state at 2 (the oldest) is a dropped edit state.
    const states = [makeDiskNowState(), makeWriteState(50, 11), makeDroppedEditState(40, 12)];
    // The sidecar lists no script gap and has no bornless record.
    const sidecar = buildReplayGapsSidecar(states);
    assert.deepEqual(sidecar.gaps, []);
    assert.equal(sidecar.bornless, null);
});

test("test_task_record_round_trip_keeps_the_script_run", () => {
    // Scenario: a script run turned into a task record and back is equal to the original.
    // Steps: the run has every field the record keeps.
    const run = makeScriptRun(30, 12);
    // The record holds the task id, the ISO instant and the plain values.
    const record = convertScriptRunToTaskRecord(run);
    assert.equal(record.taskId, `${JSONL_PATH}:12:toolu_12`);
    assert.equal(record.instant, makeInstant(30).toISOString());
    assert.equal(record.cwd, "/project");
    // The run built back from the record equals the original run.
    assert.deepEqual(convertTaskRecordToScriptRun(record), run);
});

test("test_gap_is_half_dropped_when_the_newer_commit_has_the_same_event", () => {
    // Scenario: a gap whose first dropped state shares its event with the newer commit is half dropped.
    // Steps: the first dropped state is the BeforeEvent state of a script event; the newer commit is made by the same event.
    const droppedState = makeState(makeScriptEvent(10, 5), StateConfidence.Unknown, undefined, StateMoment.BeforeEvent);
    const newerCommit = makeInverseCommit({ eventType: FileEventType.ScriptMayWrite, jsonlPath: new Path(JSONL_PATH), line: 5, instant: makeInstant(10) });
    // The function says the gap is half dropped.
    assert.equal(isGapHalfDropped(makeGapOfDroppedState(droppedState), newerCommit), true);
});

test("test_gap_is_not_half_dropped_when_the_newer_commit_has_another_event", () => {
    // Scenario: a gap whose newer commit is made by another event is not half dropped.
    // Steps: the first dropped state is a script state at line 5; the newer commit is at another line, in another file, or has another type or instant.
    const droppedState = makeDroppedScriptState(10, 5);
    const gap = makeGapOfDroppedState(droppedState);
    // A newer commit at another line is not the same event.
    assert.equal(isGapHalfDropped(gap, makeInverseCommit({ line: 6 })), false);
    // A newer commit in another log file is not the same event.
    assert.equal(isGapHalfDropped(gap, makeInverseCommit({ jsonlPath: new Path("/logs/other.jsonl") })), false);
    // A newer commit of another event type is not the same event.
    assert.equal(isGapHalfDropped(gap, makeInverseCommit({ eventType: FileEventType.WriteRow })), false);
    // A newer commit at another instant is not the same event.
    assert.equal(isGapHalfDropped(gap, makeInverseCommit({ instant: makeInstant(11) })), false);
});

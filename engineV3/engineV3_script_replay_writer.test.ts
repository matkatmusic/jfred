import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits, type OrderedKnownState } from "./engineV3_inverse_repo.ts";
import { ReplayGapKind, type ReplayGap } from "./engineV3_script_replay_gaps.ts";
import { writeReplayedGapIntoInverseRepo } from "./engineV3_script_replay_writer.ts";

const FILE_NAME = "a.txt";
const JSONL_PATH = "/logs/session.jsonl";
const NEWER_POSITION = 1;
const NEWEST_DROPPED_POSITION = 2;
const OLDEST_DROPPED_POSITION = 3;
const OLDER_POSITION = 4;
const NEWER_TEXT = "newer text";
const OLDER_TEXT = "older text";
const OTHER_TEXT = "other text";

function makeTempFolder(t: TestContext): Path {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-script-replay-writer-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return new Path(folder);
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
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

function makeState(event: FileEvent, confidence: StateConfidence, text: string | undefined, moment: StateMoment = StateMoment.AtEvent): FileKnownState {
    return { event, moment, confidence, isFileAbsent: text === undefined, text };
}

function makeDroppedState(event: FileEvent, moment: StateMoment, position: number): OrderedKnownState {
    return { state: makeState(event, StateConfidence.Unknown, undefined, moment), position };
}

// Disk-now at position 0, a newer write at position 1; the older write at position 4 only when withOlderCommit.
function makeRepoWithNewerCommit(t: TestContext, withOlderCommit: boolean): Path {
    const repoFolder = makeTempFolder(t);
    const diskNowState = makeState(makeEvent(FileEventType.DiskNow, undefined, undefined), StateConfidence.Proven, "now");
    createInverseRepo(repoFolder, FILE_NAME, { state: diskNowState, position: 0 }, makeInstant(100));
    const newerState = makeState(makeEvent(FileEventType.WriteRow, 50, 1), StateConfidence.Proven, NEWER_TEXT);
    insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [{ state: newerState, position: NEWER_POSITION }]);
    if (withOlderCommit) {
        const olderState = makeState(makeEvent(FileEventType.WriteRow, 5, 3), StateConfidence.Proven, OLDER_TEXT);
        insertStatesIntoInverseRepo(repoFolder, FILE_NAME, [{ state: olderState, position: OLDER_POSITION }]);
    }
    return repoFolder;
}

function makeGap(scriptEvent: FileEvent, olderPosition: number | undefined): ReplayGap {
    return {
        kind: ReplayGapKind.Dropped,
        newerPosition: NEWER_POSITION,
        olderPosition,
        droppedStates: [
            makeDroppedState(scriptEvent, StateMoment.AtEvent, NEWEST_DROPPED_POSITION),
            makeDroppedState(scriptEvent, StateMoment.BeforeEvent, OLDEST_DROPPED_POSITION),
        ],
    };
}

function makeScriptEvent(overrides: Partial<FileEvent> = {}): FileEvent {
    return makeEvent(FileEventType.ScriptMayWrite, 20, 2, overrides);
}

function makeTexts(newestText: string | undefined, oldestText: string | undefined): Map<number, string | undefined> {
    return new Map<number, string | undefined>([[NEWEST_DROPPED_POSITION, newestText], [OLDEST_DROPPED_POSITION, oldestText]]);
}

function listCommitsByPosition(repoFolder: Path) {
    return new Map(listInverseCommits(repoFolder, FILE_NAME).map((inverseCommit) => [inverseCommit.position, inverseCommit]));
}

test("test_equal_result_gives_proven_commits_at_the_dropped_positions", (t) => {
    // Scenario: the replay gives the same text as the newer commit, so both new commits are Proven.
    // A repo has a disk-now commit, a newer commit and an older commit.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    const gap = makeGap(makeScriptEvent(), OLDER_POSITION);
    // The replay text at the newest dropped position equals the newer commit text.
    const report = writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(NEWER_TEXT, OLDER_TEXT));
    // The report lists both dropped positions, says equal, and says Proven.
    assert.deepEqual(report.insertedPositions, [NEWEST_DROPPED_POSITION, OLDEST_DROPPED_POSITION]);
    assert.equal(report.isEqualToNewerCommit, true);
    assert.equal(report.confidence, StateConfidence.Proven);
    // The repo now has commits at positions 0 to 4, and both new commits are Proven with the given texts.
    const commitsByPosition = listCommitsByPosition(repoFolder);
    assert.deepEqual([...commitsByPosition.keys()], [0, 1, 2, 3, 4]);
    assert.equal(commitsByPosition.get(NEWEST_DROPPED_POSITION)!.confidence, StateConfidence.Proven);
    assert.equal(commitsByPosition.get(NEWEST_DROPPED_POSITION)!.text, NEWER_TEXT);
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.confidence, StateConfidence.Proven);
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.text, OLDER_TEXT);
});

test("test_different_result_gives_derived_commits", (t) => {
    // Scenario: the replay gives a text that differs from the newer commit, so both new commits are Derived.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    const gap = makeGap(makeScriptEvent(), OLDER_POSITION);
    // The replay text at the newest dropped position differs from the newer commit text.
    const report = writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(OTHER_TEXT, OLDER_TEXT));
    // The report says not equal and Derived.
    assert.equal(report.isEqualToNewerCommit, false);
    assert.equal(report.confidence, StateConfidence.Derived);
    // Both new commits are Derived.
    const commitsByPosition = listCommitsByPosition(repoFolder);
    assert.equal(commitsByPosition.get(NEWEST_DROPPED_POSITION)!.confidence, StateConfidence.Derived);
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.confidence, StateConfidence.Derived);
});

test("test_before_state_of_oldest_event_in_history_end_gap_is_derived_even_when_equal", (t) => {
    // Scenario: in a history-end gap the before-event state of the oldest event is a guess, so it stays Derived.
    // A repo has a disk-now commit and a newer commit, and no older commit.
    const repoFolder = makeRepoWithNewerCommit(t, false);
    const gap = makeGap(makeScriptEvent(), undefined);
    // The replay text equals the newer commit text.
    const report = writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(NEWER_TEXT, OLDER_TEXT));
    // The at-event commit is Proven, and the report confidence is that of the newest inserted state.
    const commitsByPosition = listCommitsByPosition(repoFolder);
    assert.equal(commitsByPosition.get(NEWEST_DROPPED_POSITION)!.confidence, StateConfidence.Proven);
    assert.equal(report.confidence, StateConfidence.Proven);
    // The before-event commit of the oldest event is Derived.
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.moment, StateMoment.BeforeEvent);
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.confidence, StateConfidence.Derived);
});

test("test_commits_keep_the_original_event_fields_in_the_message", (t) => {
    // Scenario: the new commits keep the event type, moment, source, instant and script flags of the dropped states.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    const movedAwayToFile = new Path("/project/moved.txt");
    const gap = makeGap(makeScriptEvent({ removedByScript: true, movedAwayToFile }), OLDER_POSITION);
    writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(NEWER_TEXT, OLDER_TEXT));
    // The newest dropped commit keeps its event fields and its at-event moment.
    const commitsByPosition = listCommitsByPosition(repoFolder);
    const newestCommit = commitsByPosition.get(NEWEST_DROPPED_POSITION)!;
    assert.equal(newestCommit.eventType, FileEventType.ScriptMayWrite);
    assert.equal(newestCommit.moment, StateMoment.AtEvent);
    assert.equal(newestCommit.jsonlPath!.toString(), JSONL_PATH);
    assert.equal(newestCommit.line, 2);
    assert.equal(newestCommit.instant!.getTime(), makeInstant(20).getTime());
    assert.equal(newestCommit.removedByScript, true);
    assert.equal(newestCommit.movedAwayToFile!.toString(), movedAwayToFile.toString());
    // The oldest dropped commit keeps its before-event moment.
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.moment, StateMoment.BeforeEvent);
});

test("test_absent_result_gives_an_absent_commit", (t) => {
    // Scenario: a replay text of undefined gives a commit for an absent file.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    const gap = makeGap(makeScriptEvent(), OLDER_POSITION);
    // The newest dropped position has no file, and the oldest has a text.
    writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(undefined, OLDER_TEXT));
    // The newest dropped commit is absent and has no text. The oldest is present.
    const commitsByPosition = listCommitsByPosition(repoFolder);
    assert.equal(commitsByPosition.get(NEWEST_DROPPED_POSITION)!.isFileAbsent, true);
    assert.equal(commitsByPosition.get(NEWEST_DROPPED_POSITION)!.text, undefined);
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.isFileAbsent, false);
    assert.equal(commitsByPosition.get(OLDEST_DROPPED_POSITION)!.text, OLDER_TEXT);
});

test("test_missing_text_for_a_dropped_position_throws", (t) => {
    // Scenario: the text map lacks one dropped position, so the writer throws and writes nothing.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    const gap = makeGap(makeScriptEvent(), OLDER_POSITION);
    const textsMissingOldest = new Map<number, string | undefined>([[NEWEST_DROPPED_POSITION, NEWER_TEXT]]);
    assert.throws(() => writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, textsMissingOldest), /position 3/);
    // The repo still has only the 3 original commits.
    assert.deepEqual([...listCommitsByPosition(repoFolder).keys()], [0, 1, 4]);
});

test("test_position_already_stored_throws", (t) => {
    // Scenario: writing the same gap twice throws the second time, because the positions are taken.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    const gap = makeGap(makeScriptEvent(), OLDER_POSITION);
    writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(NEWER_TEXT, OLDER_TEXT));
    assert.throws(() => writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(NEWER_TEXT, OLDER_TEXT)), /already has a commit/);
});

test("test_half_dropped_gap_throws", (t) => {
    // Scenario: the first dropped state shares its event with the newer commit, so the writer throws.
    const repoFolder = makeRepoWithNewerCommit(t, true);
    // The newer commit was made by a WriteRow event at second 50, line 1. The dropped state uses the same event.
    const newerEvent = makeEvent(FileEventType.WriteRow, 50, 1);
    const gap = makeGap(newerEvent, OLDER_POSITION);
    assert.throws(() => writeReplayedGapIntoInverseRepo(repoFolder, FILE_NAME, gap, makeTexts(NEWER_TEXT, OLDER_TEXT)), /half/);
    // The repo still has only the 3 original commits.
    assert.deepEqual([...listCommitsByPosition(repoFolder).keys()], [0, 1, 4]);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import { GuessCategory, ToolName } from "../src/structures/vocabulary.ts";
import { StateConfidence } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { EditRow } from "../engineV3/engineV3_replay_reverse.ts";
import { chooseGuessCategory, describeEventsAfterBoundary, listGuessStatesOfFile, type GuessFacts } from "../engineV3/engineV3_guess_files.ts";
import { assessFileGuesses } from "../engineV3/engineV3_guess_files_assess.ts";
import { listPathsNamedInLines } from "../engineV3/engineV3_guess_files_paths.ts";

const TEXT_AFTER_EDIT = "one TWO three";
const TEXT_BEFORE_EDIT = "one two three";
const TEXT_UNRELATED = "something else entirely";

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEvent(type: FileEventType, second: number | undefined, fields: Partial<FileEvent> = {}): FileEvent {
    let instant: Date | undefined;
    if (second !== undefined) {
        instant = makeInstant(second);
    }
    return { type, instant, source: undefined, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined, ...fields };
}

function makeDiskNowEvent(text: string): FileEvent {
    return makeEvent(FileEventType.DiskNow, undefined, { bytes: text });
}

function makeGitCommitEvent(second: number, text: string): FileEvent {
    return makeEvent(FileEventType.GitCommit, second, { bytes: text });
}

function makePartialEditEvent(second: number, oldString: string, newString: string): FileEvent {
    const row: EditRow = { toolName: ToolName.Edit, timestamp: makeInstant(second), source: undefined, oldString, newString, replaceAll: false, originalFile: undefined };
    return makeEvent(FileEventType.EditRow, second, { row });
}

function makeFacts(changes: Partial<GuessFacts>): GuessFacts {
    return { hasModifyingEventAfterBoundary: false, hasReadEventAfterBoundary: false, guessStateCount: 0, isAbsentAtBoundary: false, lineCount: 5, isPathNamedInLines: true, ...changes };
}

test("test_a_partial_edit_between_beacons_with_equal_text_gives_no_guess_state", () => {
    // Scenario: disk, then a partial Edit, then a commit whose text equals the Edit undone.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_BEFORE_EDIT)];
    // The Edit states are confirmed, so the file has a clear walk.
    assert.deepEqual(listGuessStatesOfFile(events), []);
});

test("test_a_partial_edit_with_no_older_beacon_gives_two_derived_guess_states", () => {
    // Scenario: disk, then a partial Edit, and nothing older.
    const guessStates = listGuessStatesOfFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO")]);
    // Both states of the Edit are derived.
    assert.deepEqual(guessStates.map((state) => state.confidence), [StateConfidence.Derived, StateConfidence.Derived]);
    assert.equal(guessStates[0]!.event.type, FileEventType.EditRow);
});

test("test_a_partial_edit_with_an_unrelated_older_beacon_gives_derived_guess_states", () => {
    // Scenario: the commit text is unrelated to the Edit.
    const guessStates = listGuessStatesOfFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)]);
    // The Edit states stay derived.
    assert.equal(guessStates.length, 2);
});

test("test_the_boundary_commit_event_does_not_count_as_a_modifying_event_after_the_boundary", () => {
    // Scenario: the boundary instant is second 10; the events are the disk, a read at second 12 and the boundary commit at second 10.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeEvent(FileEventType.ReadWhole, 12, { bytes: TEXT_AFTER_EDIT }), makeGitCommitEvent(10, TEXT_AFTER_EDIT)];
    const described = describeEventsAfterBoundary(events, makeInstant(10));
    // The commit at the boundary is not a change after the boundary.
    assert.equal(described.hasModifyingEvent, false);
    // The read at second 12 is a read event after the boundary.
    assert.equal(described.hasReadEvent, true);
});

test("test_an_edit_after_the_boundary_is_a_modifying_event_after_the_boundary", () => {
    // Scenario: the boundary instant is second 10; an Edit happens at second 11.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(11, "two", "TWO"), makeGitCommitEvent(10, TEXT_BEFORE_EDIT)];
    // The Edit counts.
    assert.equal(describeEventsAfterBoundary(events, makeInstant(10)).hasModifyingEvent, true);
});

test("test_the_disk_now_event_alone_is_not_a_read_event", () => {
    // Scenario: a file with only the DiskNow event.
    const described = describeEventsAfterBoundary([makeDiskNowEvent(TEXT_AFTER_EDIT)], undefined);
    // Neither flag is set.
    assert.deepEqual(described, { hasModifyingEvent: false, hasReadEvent: false });
});

test("test_with_no_boundary_every_modifying_event_counts", () => {
    // Scenario: an old commit and no boundary.
    const described = describeEventsAfterBoundary([makeDiskNowEvent(TEXT_AFTER_EDIT), makeGitCommitEvent(1, TEXT_BEFORE_EDIT)], undefined);
    // The commit counts as a modifying event.
    assert.equal(described.hasModifyingEvent, true);
});

test("test_category_has_guess_steps_when_modifying_events_leave_guess_states", () => {
    assert.equal(chooseGuessCategory(makeFacts({ hasModifyingEventAfterBoundary: true, guessStateCount: 2 })), GuessCategory.HasGuessSteps);
});

test("test_no_category_when_modifying_events_leave_no_guess_state", () => {
    assert.equal(chooseGuessCategory(makeFacts({ hasModifyingEventAfterBoundary: true, guessStateCount: 0 })), undefined);
});

test("test_category_no_log_lines_when_no_log_line_names_the_file", () => {
    assert.equal(chooseGuessCategory(makeFacts({ lineCount: 0, isPathNamedInLines: false })), GuessCategory.NoLogLines);
});

test("test_category_log_names_other_path_when_lines_name_only_another_folder", () => {
    assert.equal(chooseGuessCategory(makeFacts({ lineCount: 3, isPathNamedInLines: false })), GuessCategory.LogNamesOtherPath);
});

test("test_category_absent_at_start_commit_when_the_path_is_named_and_absent_at_the_boundary", () => {
    assert.equal(chooseGuessCategory(makeFacts({ isAbsentAtBoundary: true, hasReadEventAfterBoundary: true })), GuessCategory.AbsentAtStartCommit);
});

test("test_category_no_changing_events_when_the_path_is_named_and_only_reads_follow_the_boundary", () => {
    assert.equal(chooseGuessCategory(makeFacts({ hasReadEventAfterBoundary: true })), GuessCategory.NoChangingEvents);
});

test("test_no_category_when_the_path_is_named_but_no_event_follows_the_boundary", () => {
    assert.equal(chooseGuessCategory(makeFacts({})), undefined);
});

test("test_log_lines_naming_the_exact_path_and_another_folder_are_both_listed", () => {
    // Scenario: two lines; one names the file, one names a file with the same name in a worktree.
    const lines = [{ message: "Edit /project/src/a.ts now" }, { message: "Edit /worktree/src/a.ts now" }];
    // Both full paths come back.
    assert.deepEqual(listPathsNamedInLines(lines, new Path("/project/src/a.ts")), ["/project/src/a.ts", "/worktree/src/a.ts"]);
});

test("test_log_lines_naming_a_longer_file_name_do_not_name_the_file", () => {
    // Scenario: a line names /project/src/a.tsx and /project/src/xa.ts, not a.ts.
    const lines = [{ message: "/project/src/a.tsx and /project/src/xa.ts" }];
    // No path is listed.
    assert.deepEqual(listPathsNamedInLines(lines, new Path("/project/src/a.ts")), []);
});

test("test_assess_a_disk_only_file_with_no_log_lines_gives_no_log_lines", () => {
    // Scenario: no boundary, one DiskNow event, no log lines.
    const assessment = assessFileGuesses(new Path("/project/a.ts"), [makeDiskNowEvent(TEXT_AFTER_EDIT)], [], undefined);
    // The category is no-log-lines and nothing is listed under the file.
    assert.equal(assessment.category, GuessCategory.NoLogLines);
    assert.deepEqual(assessment.otherPaths, []);
});

test("test_assess_a_disk_only_file_whose_lines_name_a_worktree_path_lists_that_path", () => {
    // Scenario: no boundary, one DiskNow event, one log line that names the file in a worktree.
    const assessment = assessFileGuesses(new Path("/project/a.ts"), [makeDiskNowEvent(TEXT_AFTER_EDIT)], [{ message: "Edit /worktree/a.ts" }], undefined);
    // The category is log-names-other-path with the worktree path.
    assert.equal(assessment.category, GuessCategory.LogNamesOtherPath);
    assert.deepEqual(assessment.otherPaths, ["/worktree/a.ts"]);
});

test("test_assess_lists_every_other_path", () => {
    // Scenario: the lines name the file in four other folders.
    const lines = [{ message: "/w1/a.ts /w2/a.ts /w3/a.ts /w4/a.ts" }];
    const assessment = assessFileGuesses(new Path("/project/a.ts"), [makeDiskNowEvent(TEXT_AFTER_EDIT)], lines, undefined);
    // All four are kept.
    assert.deepEqual(assessment.otherPaths, ["/w1/a.ts", "/w2/a.ts", "/w3/a.ts", "/w4/a.ts"]);
});

test("test_assess_a_file_with_a_derived_edit_lists_the_guess_states", () => {
    // Scenario: disk, then a partial Edit and nothing older.
    const assessment = assessFileGuesses(new Path("/project/a.ts"), [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO")], [{ message: "/project/a.ts" }], undefined);
    // The category is has-guess-steps with two states.
    assert.equal(assessment.category, GuessCategory.HasGuessSteps);
    assert.equal(assessment.guessStates.length, 2);
});

test("test_log_lines_with_a_relative_path_name_no_absolute_path", () => {
    // Scenario: a line names src/a.ts by a relative path.
    const lines = [{ message: "Read src/a.ts" }];
    // The relative path is not an absolute path, so nothing is listed.
    assert.deepEqual(listPathsNamedInLines(lines, new Path("/project/src/a.ts")), []);
});

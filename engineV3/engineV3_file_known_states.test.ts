import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { ReverseStateKind, type EditRow, type WriteRow } from "./engineV3_replay_reverse.ts";
import { FileEventType, createNodesWhenBytesDiffer, sortEventsNewestToOldest, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { StateConfidence, StateMoment, getTextJustBeforeInstant, listKnownStatesForFile, type FileKnownState } from "./engineV3_file_known_states.ts";

const TEXT_AFTER_EDIT = "one TWO three";
const TEXT_BEFORE_EDIT = "one two three";
const TEXT_UNRELATED = "something else entirely";
const TEXT_BORN = "born";
const MOVE_OR_COPY_SOURCE_FILE = new Path("/project/source.py");

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

function makeDiskNowEvent(text: string | undefined): FileEvent {
    return makeEvent(FileEventType.DiskNow, undefined, { bytes: text });
}

function makeGitCommitEvent(second: number, text: string): FileEvent {
    return makeEvent(FileEventType.GitCommit, second, { bytes: text });
}

function makePartialEditEvent(second: number, oldString: string, newString: string): FileEvent {
    const row: EditRow = { toolName: ToolName.Edit, timestamp: makeInstant(second), source: undefined, oldString, newString, replaceAll: false, originalFile: undefined };
    return makeEvent(FileEventType.EditRow, second, { row });
}

function makeEditWithOriginalFileEvent(second: number, oldString: string, newString: string, originalFile: string): FileEvent {
    const row: EditRow = { toolName: ToolName.Edit, timestamp: makeInstant(second), source: undefined, oldString, newString, replaceAll: false, originalFile };
    return makeEvent(FileEventType.EditRow, second, { row });
}

function makeWriteEvent(second: number, content: string, isCreate: boolean, originalFile: string | undefined): FileEvent {
    const row: WriteRow = { toolName: ToolName.Write, timestamp: makeInstant(second), source: undefined, isCreate, content, originalFile };
    return makeEvent(FileEventType.WriteRow, second, { row });
}

function makeMayWriteScriptEvent(second: number): FileEvent {
    return makeEvent(FileEventType.ScriptMayWrite, second);
}

function makeMoveOrCopyScriptEvent(second: number, moveOrCopySourceFile: Path | undefined, bytes: string | undefined = undefined): FileEvent {
    return { ...makeMayWriteScriptEvent(second), moveOrCopySourceFile, bytes };
}

function makeRemovedByScriptEvent(second: number): FileEvent {
    return { ...makeMayWriteScriptEvent(second), removedByScript: true };
}

function makeMovedAwayScriptEvent(second: number, movedAwayToFile: Path): FileEvent {
    return { ...makeMayWriteScriptEvent(second), movedAwayToFile };
}

function makeReadOnlyScriptEvent(second: number): FileEvent {
    return makeEvent(FileEventType.ScriptReadOnly, second);
}

function makeState(second: number | undefined, confidence: StateConfidence, isFileAbsent: boolean, text: string | undefined): FileKnownState {
    return { event: makeEvent(FileEventType.GitCommit, second), moment: StateMoment.AtEvent, confidence, isFileAbsent, text };
}

function describeStates(states: FileKnownState[]): string[] {
    return states.map((state) => `${state.event.type}/${state.moment}/${state.confidence}`);
}

test("test_disk_now_only_gives_one_proven_state", () => {
    // Scenario: the only event is the file on disk now.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT)]);
    // One state: the file at that event, proven, with the disk text.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven"]);
    assert.equal(states[0]!.text, TEXT_AFTER_EDIT);
    assert.equal(states[0]!.isFileAbsent, false);
});

test("test_disk_now_absent_gives_proven_absent_state", () => {
    // Scenario: the file is not on disk now.
    const states = listKnownStatesForFile([makeDiskNowEvent(undefined)]);
    // The state is proven, the file is absent, and there is no text.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven"]);
    assert.equal(states[0]!.isFileAbsent, true);
    assert.equal(states[0]!.text, undefined);
});

test("test_partial_edit_is_confirmed_when_older_beacon_has_equal_text", () => {
    // Scenario: disk, then a partial Edit, then a commit whose text equals the Edit undone.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_BEFORE_EDIT)];
    const states = listKnownStatesForFile(events);
    // Both states of the Edit are confirmed and carry the worked-out texts.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "EditRow/at-event/confirmed", "EditRow/before-event/confirmed", "GitCommit/at-event/proven"]);
    assert.equal(states[1]!.text, TEXT_AFTER_EDIT);
    assert.equal(states[2]!.text, TEXT_BEFORE_EDIT);
});

test("test_partial_edit_stays_derived_when_older_beacon_text_differs_without_roadblock", () => {
    // Scenario: same as the confirmed case, but the commit text is unrelated.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const states = listKnownStatesForFile(events);
    // The Edit states stay derived with their worked-out texts.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "EditRow/at-event/derived", "EditRow/before-event/derived", "GitCommit/at-event/proven"]);
    assert.equal(states[2]!.text, TEXT_BEFORE_EDIT);
});

test("test_partial_edit_is_derived_when_there_is_no_older_beacon", () => {
    // Scenario: disk, then a partial Edit, and nothing older.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(2, "two", "TWO")]);
    // The Edit states stay derived.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "EditRow/at-event/derived", "EditRow/before-event/derived"]);
});

test("test_states_behind_may_write_script_are_unknown_when_older_beacon_text_differs", () => {
    // Scenario: disk, a may-write script, a partial Edit, then a commit with unrelated text.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeMayWriteScriptEvent(3), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const states = listKnownStatesForFile(events);
    // The script state and both Edit states are unknown, with no text.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/unknown", "EditRow/at-event/unknown", "EditRow/before-event/unknown", "GitCommit/at-event/proven"]);
    for (const state of states.slice(1, 4)) {
        assert.equal(state.text, undefined);
        assert.equal(state.isFileAbsent, false);
    }
    // The older commit is proven with its own text.
    assert.equal(states[4]!.text, TEXT_UNRELATED);
});

test("test_may_write_script_state_is_confirmed_when_older_beacon_text_is_equal", () => {
    // Scenario: disk, a may-write script, then a commit with the same text.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeMayWriteScriptEvent(2), makeGitCommitEvent(1, TEXT_AFTER_EDIT)];
    const states = listKnownStatesForFile(events);
    // The script state is confirmed with that text.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/confirmed", "GitCommit/at-event/proven"]);
    assert.equal(states[1]!.text, TEXT_AFTER_EDIT);
});

test("test_read_only_script_between_beacons_with_equal_text_is_confirmed", () => {
    // Scenario: disk, a read-only script, then a commit with the same text.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeReadOnlyScriptEvent(2), makeGitCommitEvent(1, TEXT_AFTER_EDIT)];
    const states = listKnownStatesForFile(events);
    // The script state is confirmed.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptReadOnly/at-event/confirmed", "GitCommit/at-event/proven"]);
});

test("test_read_only_script_does_not_block_the_walk", () => {
    // Scenario: disk, a read-only script, a partial Edit, then a commit with unrelated text.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeReadOnlyScriptEvent(3), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const states = listKnownStatesForFile(events);
    // Nothing is unknown: the script and Edit states stay derived.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptReadOnly/at-event/derived", "EditRow/at-event/derived", "EditRow/before-event/derived", "GitCommit/at-event/proven"]);
});

test("test_partial_edit_with_missing_new_string_is_unknown_and_blocks_older_partial_edit", () => {
    // Scenario: disk, then a partial Edit whose newString is not in the disk text, then an older partial Edit, then a commit.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(3, "x", "MISSING"), makePartialEditEvent(2, "one", "ONE"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const states = listKnownStatesForFile(events);
    // The first Edit: the at-event state keeps the disk text (derived); the undo fails, so the before-event state is unknown.
    assert.equal(states[1]!.confidence, StateConfidence.Derived);
    assert.equal(states[2]!.confidence, StateConfidence.Unknown);
    assert.equal(states[2]!.moment, StateMoment.BeforeEvent);
    assert.equal(states[2]!.text, undefined);
    // The older partial Edit has no known text to undo from: both states are unknown.
    assert.equal(states[3]!.confidence, StateConfidence.Unknown);
    assert.equal(states[4]!.confidence, StateConfidence.Unknown);
    // The commit is proven again.
    assert.equal(states[5]!.confidence, StateConfidence.Proven);
});

test("test_edit_with_original_file_gives_two_proven_states", () => {
    // Scenario: an Edit that carries originalFile.
    const events = [makeEditWithOriginalFileEvent(1, "two", "TWO", TEXT_BEFORE_EDIT)];
    const states = listKnownStatesForFile(events);
    // At-event is proven with the edited text; before-event is proven with originalFile.
    assert.deepEqual(describeStates(states), ["EditRow/at-event/proven", "EditRow/before-event/proven"]);
    assert.equal(states[0]!.text, TEXT_AFTER_EDIT);
    assert.equal(states[1]!.text, TEXT_BEFORE_EDIT);
});

test("test_write_that_created_the_file_gives_proven_absent_before_state", () => {
    // Scenario: a Write that created the file.
    const states = listKnownStatesForFile([makeWriteEvent(1, TEXT_AFTER_EDIT, true, undefined)]);
    // The before-event state is proven and the file is absent.
    assert.deepEqual(describeStates(states), ["WriteRow/at-event/proven", "WriteRow/before-event/proven"]);
    assert.equal(states[1]!.isFileAbsent, true);
    assert.equal(states[1]!.text, undefined);
});

test("test_write_with_original_file_gives_proven_before_state_with_that_text", () => {
    // Scenario: a Write that overwrote a file and carries originalFile.
    const states = listKnownStatesForFile([makeWriteEvent(1, TEXT_AFTER_EDIT, false, TEXT_UNRELATED)]);
    // The before-event state holds the originalFile text.
    assert.equal(states[1]!.text, TEXT_UNRELATED);
    assert.equal(states[1]!.isFileAbsent, false);
});

test("test_write_overwrite_without_original_file_gives_no_before_state_and_blocks_older_partial_edit", () => {
    // Scenario: a Write that overwrote with no originalFile, then an older partial Edit, then a commit.
    const events = [makeWriteEvent(3, TEXT_AFTER_EDIT, false, undefined), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const states = listKnownStatesForFile(events);
    // No before-event state for the Write; the older Edit has no known text to undo from.
    assert.deepEqual(describeStates(states), ["WriteRow/at-event/proven", "EditRow/at-event/unknown", "EditRow/before-event/unknown", "GitCommit/at-event/proven"]);
});

test("test_output_is_newest_first_with_at_event_before_before_event", () => {
    // Scenario: events given in oldest-first order, sorted by the existing sort.
    const unsorted = [makeGitCommitEvent(1, TEXT_BEFORE_EDIT), makeEditWithOriginalFileEvent(2, "two", "TWO", TEXT_BEFORE_EDIT), makeDiskNowEvent(TEXT_AFTER_EDIT)];
    const states = listKnownStatesForFile(sortEventsNewestToOldest(unsorted));
    // Newest first; the Edit's at-event state comes right before its before-event state.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "EditRow/at-event/proven", "EditRow/before-event/proven", "GitCommit/at-event/proven"]);
});

test("test_oldest_move_or_copy_destination_gives_derived_absent_before_state", () => {
    // Scenario: disk, then a may-write script that moved a file onto this file; nothing is older.
    const moveEvent = makeMoveOrCopyScriptEvent(1, MOVE_OR_COPY_SOURCE_FILE);
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), moveEvent]);
    // The last state is for the move event, before it, derived, with the file absent and no text.
    const lastState = states[states.length - 1]!;
    assert.equal(lastState.event, moveEvent);
    assert.equal(lastState.moment, StateMoment.BeforeEvent);
    assert.equal(lastState.confidence, StateConfidence.Derived);
    assert.equal(lastState.isFileAbsent, true);
    assert.equal(lastState.text, undefined);
});

test("test_oldest_move_or_copy_destination_keeps_its_at_event_state", () => {
    // Scenario: same events as the absent-before-state case.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makeMoveOrCopyScriptEvent(1, MOVE_OR_COPY_SOURCE_FILE)]);
    // The at-event state of the move event is unknown with no text, as it was before this change.
    assert.equal(states[1]!.moment, StateMoment.AtEvent);
    assert.equal(states[1]!.confidence, StateConfidence.Unknown);
    assert.equal(states[1]!.isFileAbsent, false);
    assert.equal(states[1]!.text, undefined);
});

test("test_oldest_may_write_script_that_is_not_a_destination_gives_no_absent_state", () => {
    // Scenario: disk, then an oldest may-write script whose moveOrCopySourceFile is undefined.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makeMoveOrCopyScriptEvent(1, undefined)]);
    // No state says the file is absent.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/unknown"]);
    assert.equal(states.some((state) => state.isFileAbsent), false);
});

test("test_move_or_copy_destination_with_an_older_beacon_gives_no_absent_state", () => {
    // Scenario: disk, a move-or-copy destination script, then an older write with text.
    const moveEvent = makeMoveOrCopyScriptEvent(2, MOVE_OR_COPY_SOURCE_FILE);
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), moveEvent, makeWriteEvent(1, TEXT_UNRELATED, false, undefined)]);
    // The move event is not the oldest event: it has no before-event state and no state is absent.
    assert.equal(states.some((state) => state.event === moveEvent && state.moment === StateMoment.BeforeEvent), false);
    assert.equal(states.some((state) => state.isFileAbsent), false);
});

test("test_oldest_move_or_copy_destination_with_born_bytes_gives_derived_at_event_text", () => {
    // Scenario: disk, then an oldest move-or-copy destination script that carries the born text.
    const moveEvent = makeMoveOrCopyScriptEvent(1, MOVE_OR_COPY_SOURCE_FILE, TEXT_BORN);
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), moveEvent]);
    // The move event has an at-event state, derived, with the born text and not absent.
    assert.equal(states[1]!.event, moveEvent);
    assert.equal(states[1]!.moment, StateMoment.AtEvent);
    assert.equal(states[1]!.confidence, StateConfidence.Derived);
    assert.equal(states[1]!.isFileAbsent, false);
    assert.equal(states[1]!.text, TEXT_BORN);
    // The before-event state follows: derived and absent.
    assert.equal(states[2]!.moment, StateMoment.BeforeEvent);
    assert.equal(states[2]!.confidence, StateConfidence.Derived);
    assert.equal(states[2]!.isFileAbsent, true);
    assert.equal(states.length, 3);
});

test("test_oldest_move_or_copy_destination_without_born_bytes_keeps_unknown_at_event_state", () => {
    // Scenario: same events, but the born bytes are undefined.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makeMoveOrCopyScriptEvent(1, MOVE_OR_COPY_SOURCE_FILE, undefined)]);
    // The at-event state is unknown with no text, and the absent before-event state is still there.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/unknown", "ScriptMayWrite/before-event/derived"]);
    assert.equal(states[1]!.text, undefined);
    assert.equal(states[2]!.isFileAbsent, true);
});

test("test_born_bytes_do_not_confirm_a_read_only_script_state", () => {
    // Scenario: disk, a read-only script, then an oldest move-or-copy destination with born bytes.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makeReadOnlyScriptEvent(2), makeMoveOrCopyScriptEvent(1, MOVE_OR_COPY_SOURCE_FILE, TEXT_BORN)]);
    // The read-only state is the same as without born bytes: derived, with the disk text.
    assert.equal(states[1]!.event.type, FileEventType.ScriptReadOnly);
    assert.equal(states[1]!.confidence, StateConfidence.Derived);
    assert.equal(states[1]!.text, TEXT_AFTER_EDIT);
});

test("test_a_removed_by_script_event_keeps_an_absent_derived_state_when_an_older_write_has_text", () => {
    // Scenario: disk, a script that removes the file, then an older write with text.
    const removeEvent = makeRemovedByScriptEvent(2);
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), removeEvent, makeWriteEvent(1, TEXT_UNRELATED, false, undefined)]);
    // The script state is derived, not unknown.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/derived", "WriteRow/at-event/proven"]);
    // The file is absent right after the script, with no text.
    assert.equal(states[1]!.event, removeEvent);
    assert.equal(states[1]!.isFileAbsent, true);
    assert.equal(states[1]!.text, undefined);
});

test("test_a_moved_away_event_keeps_an_absent_derived_state_when_an_older_write_has_text", () => {
    // Scenario: disk, a script that moves the file away, then an older write with text.
    const moveAwayEvent = makeMovedAwayScriptEvent(2, MOVE_OR_COPY_SOURCE_FILE);
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), moveAwayEvent, makeWriteEvent(1, TEXT_UNRELATED, false, undefined)]);
    // The script state is derived, not unknown.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/derived", "WriteRow/at-event/proven"]);
    // The file is absent right after the script, with no text.
    assert.equal(states[1]!.event, moveAwayEvent);
    assert.equal(states[1]!.isFileAbsent, true);
    assert.equal(states[1]!.text, undefined);
});

test("test_a_script_event_without_the_flags_still_settles_to_unknown", () => {
    // Scenario: disk, a may-write script with no remove or move-away flag, then an older write with text.
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), makeMayWriteScriptEvent(2), makeWriteEvent(1, TEXT_UNRELATED, false, undefined)]);
    // The script state is unknown, with no text.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/unknown", "WriteRow/at-event/proven"]);
    assert.equal(states[1]!.isFileAbsent, false);
    assert.equal(states[1]!.text, undefined);
});

test("test_a_removed_by_script_event_that_is_the_oldest_event_gives_one_absent_derived_state", () => {
    // Scenario: disk, then a script that removes the file; nothing is older.
    const removeEvent = makeRemovedByScriptEvent(1);
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), removeEvent]);
    // The script gives exactly one state: derived, at the event, with the file absent.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "ScriptMayWrite/at-event/derived"]);
    assert.equal(states[1]!.event, removeEvent);
    assert.equal(states[1]!.isFileAbsent, true);
    assert.equal(states[1]!.text, undefined);
});

test("test_get_text_just_before_instant_returns_text_of_newest_older_state", () => {
    // Scenario: states at second 3, 2 and 1, and an instant between 2 and 3.
    const states = [makeState(3, StateConfidence.Proven, false, "three"), makeState(2, StateConfidence.Proven, false, "two"), makeState(1, StateConfidence.Proven, false, "one")];
    // The text of the state at second 2 comes back.
    assert.equal(getTextJustBeforeInstant(states, makeInstant(2.5)), "two");
});

test("test_get_text_just_before_instant_returns_undefined_when_first_older_state_is_unknown", () => {
    // Scenario: the first older state is unknown; a still older state has a text.
    const states = [makeState(2, StateConfidence.Unknown, false, undefined), makeState(1, StateConfidence.Proven, false, "one")];
    // The older text is not used.
    assert.equal(getTextJustBeforeInstant(states, makeInstant(3)), undefined);
});

test("test_get_text_just_before_instant_returns_undefined_when_first_older_state_is_absent", () => {
    // Scenario: the first older state says the file is absent; a still older state has a text.
    const states = [makeState(2, StateConfidence.Proven, true, undefined), makeState(1, StateConfidence.Proven, false, "one")];
    // The older text is not used.
    assert.equal(getTextJustBeforeInstant(states, makeInstant(3)), undefined);
});

test("test_get_text_just_before_instant_returns_undefined_when_no_state_is_older_and_skips_states_without_instant", () => {
    // Scenario: a state with no instant, and states at second 2 and 3; the instant is second 2.
    const states = [makeState(undefined, StateConfidence.Proven, false, "disk"), makeState(3, StateConfidence.Proven, false, "three"), makeState(2, StateConfidence.Proven, false, "two")];
    // No state is strictly older, and the state without an instant is passed over.
    assert.equal(getTextJustBeforeInstant(states, makeInstant(2)), undefined);
});

test("test_partial_edit_with_no_known_newer_text_is_applied_forward_onto_the_older_beacon", () => {
    // Scenario: a Write with no originalFile (no text to undo from), then a partial Edit, then a commit that holds the text before the Edit.
    const events = [makeWriteEvent(3, TEXT_UNRELATED, false, undefined), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_BEFORE_EDIT)];
    const states = listKnownStatesForFile(events);
    // The Edit states are confirmed by the commit.
    assert.deepEqual(describeStates(states), ["WriteRow/at-event/proven", "EditRow/at-event/confirmed", "EditRow/before-event/confirmed", "GitCommit/at-event/proven"]);
    // The at-event text is the Edit applied to the commit text; the before-event text is the commit text.
    assert.equal(states[1]!.text, TEXT_AFTER_EDIT);
    assert.equal(states[2]!.text, TEXT_BEFORE_EDIT);
});

test("test_partial_edit_with_no_known_newer_text_is_not_applied_forward_when_old_string_is_not_unique", () => {
    // Scenario: same as the forward case, but the commit text holds the Edit's oldString twice.
    const events = [makeWriteEvent(3, TEXT_UNRELATED, false, undefined), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, "two two")];
    const states = listKnownStatesForFile(events);
    // Both Edit states stay unknown.
    assert.deepEqual(describeStates(states), ["WriteRow/at-event/proven", "EditRow/at-event/unknown", "EditRow/before-event/unknown", "GitCommit/at-event/proven"]);
});

test("test_user_edit_notice_gives_a_derived_state_with_its_own_text_that_an_older_beacon_does_not_change", () => {
    // Scenario: disk, a user edit notice that carries the laid-over text, then a commit with another text.
    const noticeEvent = makeEvent(FileEventType.UserEditNotice, 2, { bytes: TEXT_BORN });
    const states = listKnownStatesForFile([makeDiskNowEvent(TEXT_AFTER_EDIT), noticeEvent, makeGitCommitEvent(1, TEXT_UNRELATED)]);
    // The notice state is derived and keeps the laid-over text.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "UserEditNotice/at-event/derived", "GitCommit/at-event/proven"]);
    assert.equal(states[1]!.text, TEXT_BORN);
});

test("test_user_edit_notice_blocks_an_older_partial_edit_from_undoing_with_a_newer_text", () => {
    // Scenario: disk, a user edit notice, a partial Edit, then a commit with unrelated text.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeEvent(FileEventType.UserEditNotice, 3, { bytes: TEXT_BORN }), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const states = listKnownStatesForFile(events);
    // The Edit cannot be undone from the text before the notice, which is unknown: both Edit states are unknown.
    assert.deepEqual(describeStates(states), ["DiskNow/at-event/proven", "UserEditNotice/at-event/derived", "EditRow/at-event/unknown", "EditRow/before-event/unknown", "GitCommit/at-event/proven"]);
});

test("test_event_type_row_bytes_unknown_throws_naming_the_type", () => {
    // Scenario: an event type the walk has no rule for.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeEvent(FileEventType.RowBytesUnknown, 1)];
    // The walk throws and the message names the type.
    assert.throws(() => listKnownStatesForFile(events), /RowBytesUnknown/);
});

test("test_old_walk_characterization_for_edit_behind_may_write_script", () => {
    // This is the old behaviour the new function replaces.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeMayWriteScriptEvent(3), makePartialEditEvent(2, "two", "TWO"), makeGitCommitEvent(1, TEXT_UNRELATED)];
    const result = createNodesWhenBytesDiffer(events);
    // The old walk carries the text across the script and reports one Edit state: kind, undone text, isModifying true.
    const editStates = result.states.filter((state) => state.timestamp?.getTime() === makeInstant(2).getTime());
    assert.deepEqual(editStates.map((state) => [state.kind, state.content, state.isModifying]), [[ReverseStateKind.EditUndone, TEXT_BEFORE_EDIT, true]]);
});

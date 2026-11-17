import { test } from "node:test";
import assert from "node:assert/strict";

import { InverseStepEngine, InverseStepOutcome, ToolName } from "../src/structures/vocabulary.ts";
import type { EditRow, WriteRow } from "./engineV3_replay_reverse.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { StateConfidence, StateMoment, listKnownStatesForFile } from "./engineV3_file_known_states.ts";
import { createFileStep, findNextChangeInstant, stepFileToNextTextChange, type FileStep, type WrittenCommit } from "./engineV3_file_step.ts";

const TEXT_AFTER_EDIT = "one TWO three";
const TEXT_BEFORE_EDIT = "one two three";
const TEXT_ABC = "abc";

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

function makeWriteEvent(second: number, content: string, isCreate: boolean, originalFile: string | undefined): FileEvent {
    const row: WriteRow = { toolName: ToolName.Write, timestamp: makeInstant(second), source: undefined, isCreate, content, originalFile };
    return makeEvent(FileEventType.WriteRow, second, { row });
}

function makeMayWriteScriptEvent(second: number): FileEvent {
    return makeEvent(FileEventType.ScriptMayWrite, second);
}

// Scenario S, newest first: DiskNow, partial Edit @30, ReadPartial @20, GitCommit @10.
function makeEventsS(): FileEvent[] {
    return [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(30, "two", "TWO"), makeEvent(FileEventType.ReadPartial, 20), makeGitCommitEvent(10, TEXT_BEFORE_EDIT)];
}

function makeWrittenCommitForEvents(events: FileEvent[], position: number, confidence: StateConfidence, text: string | undefined): WrittenCommit {
    const replayedState = listKnownStatesForFile(events)[position]!;
    return { position, confidence, isFileAbsent: replayedState.isFileAbsent, text, eventType: replayedState.event.type, moment: replayedState.moment };
}

function makeWrittenCommit(position: number, confidence: StateConfidence, text: string | undefined): WrittenCommit {
    return makeWrittenCommitForEvents(makeEventsS(), position, confidence, text);
}

function createStepAtNow(events: FileEvent[], nowText: string): FileStep {
    return createFileStep(events, [makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, nowText)]);
}

function createStepOnScenarioS(): FileStep {
    return createFileStep(makeEventsS(), [makeWrittenCommit(0, StateConfidence.Proven, TEXT_AFTER_EDIT)]);
}

test("test_the_first_step_skips_the_same_text_state_and_writes_the_before_edit_text", () => {
    // Scenario: scenario S with the tip at position 0 (the DiskNow commit).
    const step = createStepOnScenarioS();
    // Step once with no bound.
    const result = stepFileToNextTextChange(step, undefined);
    // The Edit's at-event state has the same text as the tip, so the step skips it and writes the before-edit state.
    assert.equal(result.outcome, InverseStepOutcome.NewText);
    assert.equal(result.engine, InverseStepEngine.Backward);
    assert.equal(result.writtenState!.position, 2);
    assert.equal(result.writtenState!.state.text, TEXT_BEFORE_EDIT);
    // No label has changed yet.
    assert.deepEqual(result.changedLabels, []);
});

test("test_the_second_step_ends_with_no_older_change_and_lists_the_label_that_the_git_commit_confirmed", () => {
    // Scenario: scenario S, one step already done.
    const step = createStepOnScenarioS();
    stepFileToNextTextChange(step, undefined);
    // Step a second time.
    const secondResult = stepFileToNextTextChange(step, undefined);
    // Nothing older changes the text, and the git commit confirmed the label of position 2.
    assert.equal(secondResult.outcome, InverseStepOutcome.NoOlderChange);
    assert.equal(secondResult.writtenState, undefined);
    assert.deepEqual(secondResult.changedLabels, [{ position: 2, confidence: StateConfidence.Confirmed }]);
    // Step a third time: the label is reported only once.
    const thirdResult = stepFileToNextTextChange(step, undefined);
    assert.equal(thirdResult.outcome, InverseStepOutcome.NoOlderChange);
    assert.deepEqual(thirdResult.changedLabels, []);
});

test("test_a_file_that_is_absent_after_the_step_gives_the_file_absent_outcome", () => {
    // Scenario: the file is on disk with text "x", and a Write at second 5 created it.
    const events = [makeDiskNowEvent("x"), makeWriteEvent(5, "x", true, undefined)];
    const step = createStepAtNow(events, "x");
    // Step once.
    const result = stepFileToNextTextChange(step, undefined);
    // The state before the create is a file that is absent.
    assert.equal(result.outcome, InverseStepOutcome.FileAbsent);
    assert.equal(result.writtenState!.state.isFileAbsent, true);
});

test("test_a_partial_edit_that_fits_neither_way_stops_with_unknown_or_roadblock_and_the_both_failed_engine", () => {
    // Scenario: the disk text is "abc" and an Edit changes "q" to "Z", which fits neither way.
    const events = [makeDiskNowEvent(TEXT_ABC), makePartialEditEvent(30, "q", "Z")];
    const step = createStepAtNow(events, TEXT_ABC);
    // Step once.
    const result = stepFileToNextTextChange(step, undefined);
    // The step stops, writes nothing, and names the both-failed engine.
    assert.equal(result.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(result.engine, InverseStepEngine.BothFailed);
    assert.equal(result.writtenState, undefined);
    // Step again: the second Unknown state of the same pass does not stop a second click.
    const secondResult = stepFileToNextTextChange(step, undefined);
    assert.equal(secondResult.outcome, InverseStepOutcome.NoOlderChange);
});

test("test_every_pass_with_an_unknown_state_stops_a_click", () => {
    // Scenario: the disk text is "abc" and two Edits both fit neither way.
    const events = [makeDiskNowEvent(TEXT_ABC), makePartialEditEvent(30, "q", "Z"), makePartialEditEvent(20, "r", "Y")];
    const step = createStepAtNow(events, TEXT_ABC);
    // The first click stops at the first pass.
    assert.equal(stepFileToNextTextChange(step, undefined).outcome, InverseStepOutcome.UnknownOrRoadblock);
    // The second click stops at the second pass: it is not skipped as a run.
    assert.equal(stepFileToNextTextChange(step, undefined).outcome, InverseStepOutcome.UnknownOrRoadblock);
    // The third click has nothing older.
    assert.equal(stepFileToNextTextChange(step, undefined).outcome, InverseStepOutcome.NoOlderChange);
});

test("test_a_stop_names_the_event_type_and_the_jsonl_line_of_the_judged_state", () => {
    // Scenario 1: a failing Edit that carries a source line.
    const failingEdit: FileEvent = { ...makePartialEditEvent(30, "q", "Z"), source: { filePath: "a.jsonl", lineNumber: 7 } };
    const failingStep = createStepAtNow([makeDiskNowEvent(TEXT_ABC), failingEdit], TEXT_ABC);
    // Step once: the stop names the Edit and its line.
    const failingResult = stepFileToNextTextChange(failingStep, undefined);
    assert.equal(failingResult.eventType, FileEventType.EditRow);
    assert.deepEqual(failingResult.source, { filePath: "a.jsonl", lineNumber: 7 });
    // Scenario 2: a good Edit that carries a source line.
    const goodEdit: FileEvent = { ...makePartialEditEvent(30, "two", "TWO"), source: { filePath: "b.jsonl", lineNumber: 9 } };
    const goodStep = createStepAtNow([makeDiskNowEvent(TEXT_AFTER_EDIT), goodEdit], TEXT_AFTER_EDIT);
    // Step once: the written state names the Edit and its line.
    const goodResult = stepFileToNextTextChange(goodStep, undefined);
    assert.equal(goodResult.outcome, InverseStepOutcome.NewText);
    assert.equal(goodResult.eventType, FileEventType.EditRow);
    assert.deepEqual(goodResult.source, { filePath: "b.jsonl", lineNumber: 9 });
    // Step to NoOlderChange: no state is judged, so both fields are undefined.
    const lastResult = stepFileToNextTextChange(goodStep, undefined);
    assert.equal(lastResult.outcome, InverseStepOutcome.NoOlderChange);
    assert.equal(lastResult.eventType, undefined);
    assert.equal(lastResult.source, undefined);
});

test("test_a_step_with_a_bound_pauses_when_the_next_event_is_older_than_the_bound_and_writes_nothing", () => {
    // Scenario: disk "abc", an Edit at second 30 that leaves the text the same, an Edit at second 10 that changes it.
    const events = [makeDiskNowEvent(TEXT_ABC), makePartialEditEvent(30, "b", "b"), makePartialEditEvent(10, "z", "a")];
    const step = createStepAtNow(events, TEXT_ABC);
    // Step once with the bound at second 20.
    const pausedResult = stepFileToNextTextChange(step, makeInstant(20));
    // The next event (second 10) is older than the bound, so the step pauses and writes nothing.
    assert.equal(pausedResult.outcome, InverseStepOutcome.Paused);
    assert.equal(pausedResult.writtenState, undefined);
    assert.deepEqual(pausedResult.changedLabels, []);
    // Step again with no bound.
    const nextResult = stepFileToNextTextChange(step, undefined);
    // The step writes the text before the second-10 Edit.
    assert.equal(nextResult.outcome, InverseStepOutcome.NewText);
    assert.equal(nextResult.writtenState!.state.event.instant!.getTime(), makeInstant(10).getTime());
});

test("test_a_step_with_no_bound_never_pauses", () => {
    // Scenario: the same events as the pause test.
    const events = [makeDiskNowEvent(TEXT_ABC), makePartialEditEvent(30, "b", "b"), makePartialEditEvent(10, "z", "a")];
    const step = createStepAtNow(events, TEXT_ABC);
    // Step once with no bound.
    const result = stepFileToNextTextChange(step, undefined);
    // The step runs past the same-text Edit and writes the new text.
    assert.equal(result.outcome, InverseStepOutcome.NewText);
});

test("test_a_step_with_a_bound_still_runs_the_first_pass_when_the_next_event_is_the_bound_instant", () => {
    // Scenario: one Edit at second 20, and the bound is second 20.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makePartialEditEvent(20, "two", "TWO")];
    const step = createStepAtNow(events, TEXT_AFTER_EDIT);
    // Step once with the bound at second 20.
    const result = stepFileToNextTextChange(step, makeInstant(20));
    // An event equal to the bound is not older, so the first pass runs.
    assert.equal(result.outcome, InverseStepOutcome.NewText);
});

test("test_a_script_that_may_write_and_leaves_the_text_the_same_stops_with_unknown_or_roadblock", () => {
    // Scenario: disk "abc", then a script at second 5 that may write the file.
    const events = [makeDiskNowEvent(TEXT_ABC), makeMayWriteScriptEvent(5)];
    const step = createStepAtNow(events, TEXT_ABC);
    // Step once.
    const result = stepFileToNextTextChange(step, undefined);
    // The step stops because the script may have changed the text, and no engine ran.
    assert.equal(result.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(result.engine, undefined);
    // Step again: nothing older is left.
    const secondResult = stepFileToNextTextChange(step, undefined);
    assert.equal(secondResult.outcome, InverseStepOutcome.NoOlderChange);
});

test("test_a_read_only_event_with_the_same_text_never_stops_a_click", () => {
    // Scenario: disk "abc", a partial read at second 5, a git commit with text "other" at second 3.
    const events = [makeDiskNowEvent(TEXT_ABC), makeEvent(FileEventType.ReadPartial, 5), makeGitCommitEvent(3, "other")];
    const step = createStepAtNow(events, TEXT_ABC);
    // Step once.
    const result = stepFileToNextTextChange(step, undefined);
    // The read is skipped and the step writes the commit text.
    assert.equal(result.outcome, InverseStepOutcome.NewText);
    assert.equal(result.writtenState!.state.text, "other");
});

test("test_a_step_restored_from_stored_commits_makes_the_same_next_step", () => {
    // Scenario: a fresh step on scenario S, stepped once; record the second result.
    const freshStep = createStepOnScenarioS();
    stepFileToNextTextChange(freshStep, undefined);
    const freshSecondResult = stepFileToNextTextChange(freshStep, undefined);
    // A second step is restored from the two stored commits.
    const restoredStep = createFileStep(makeEventsS(), [makeWrittenCommit(0, StateConfidence.Proven, TEXT_AFTER_EDIT), makeWrittenCommit(2, StateConfidence.Derived, TEXT_BEFORE_EDIT)]);
    // Step once.
    const restoredResult = stepFileToNextTextChange(restoredStep, undefined);
    // The restored step gives the same result as the fresh second step.
    assert.equal(restoredResult.outcome, InverseStepOutcome.NoOlderChange);
    assert.deepEqual(restoredResult, freshSecondResult);
});

test("test_creating_a_step_whose_stored_position_is_past_the_events_throws", () => {
    // Scenario: a stored commit at position 99 on scenario S.
    const storedCommit: WrittenCommit = { ...makeWrittenCommit(0, StateConfidence.Proven, TEXT_AFTER_EDIT), position: 99 };
    // Creating the step throws because the events end first.
    assert.throws(() => createFileStep(makeEventsS(), [storedCommit]), /the events end before the stored position 99/);
});

test("test_creating_a_step_whose_stored_commit_text_differs_from_the_replayed_state_throws", () => {
    // Scenario: the stored commit at position 2 has text that the replay does not give.
    const storedCommits = [makeWrittenCommit(0, StateConfidence.Proven, TEXT_AFTER_EDIT), makeWrittenCommit(2, StateConfidence.Derived, "different text")];
    // Creating the step throws the start-again message.
    assert.throws(() => createFileStep(makeEventsS(), storedCommits), /stored commit 2 does not match the replayed state: start again from now/);
});

test("test_creating_a_step_whose_stored_commit_event_type_differs_from_the_replayed_state_throws", () => {
    // Scenario: the stored commit at position 2 has the right text and a wrong event type.
    const wrongTypeCommit: WrittenCommit = { ...makeWrittenCommit(2, StateConfidence.Derived, TEXT_BEFORE_EDIT), eventType: FileEventType.GitCommit };
    const storedCommits = [makeWrittenCommit(0, StateConfidence.Proven, TEXT_AFTER_EDIT), wrongTypeCommit];
    // Creating the step throws the start-again message.
    assert.throws(() => createFileStep(makeEventsS(), storedCommits), /stored commit 2 does not match the replayed state: start again from now/);
});

test("test_creating_a_step_after_a_newer_event_was_added_throws", () => {
    // Scenario: the stored commits come from scenario S.
    const storedCommits = [makeWrittenCommit(0, StateConfidence.Proven, TEXT_AFTER_EDIT), makeWrittenCommit(2, StateConfidence.Derived, TEXT_BEFORE_EDIT)];
    // A newer Edit (second 40) is added right after DiskNow, so every later position moves.
    const eventsS = makeEventsS();
    const eventsWithNewerEdit = [eventsS[0]!, makePartialEditEvent(40, "three", "three"), ...eventsS.slice(1)];
    // Creating the step throws because stored position 2 no longer matches the replay.
    assert.throws(() => createFileStep(eventsWithNewerEdit, storedCommits), /does not match the replayed state/);
});

test("test_the_next_change_instant_is_the_first_modifying_event_and_skips_reads", () => {
    // Scenario: DiskNow, a ReadWhole at second 40, an Edit at second 30, a git commit at second 10.
    const events = [makeDiskNowEvent(TEXT_AFTER_EDIT), makeEvent(FileEventType.ReadWhole, 40, { bytes: TEXT_AFTER_EDIT }), makePartialEditEvent(30, "two", "TWO"), makeGitCommitEvent(10, TEXT_BEFORE_EDIT)];
    // With no step, the first modifying event is the Edit; the read is skipped.
    assert.equal(findNextChangeInstant(events, undefined)!.getTime(), makeInstant(30).getTime());
    // After one NewText step, the next modifying event is the git commit.
    const step = createStepAtNow(events, TEXT_AFTER_EDIT);
    assert.equal(stepFileToNextTextChange(step, undefined).outcome, InverseStepOutcome.NewText);
    assert.equal(findNextChangeInstant(events, step)!.getTime(), makeInstant(10).getTime());
    // After the last event is used, no modifying event is left.
    assert.equal(stepFileToNextTextChange(step, undefined).outcome, InverseStepOutcome.NoOlderChange);
    assert.equal(findNextChangeInstant(events, step), undefined);
});

test("test_creating_a_step_whose_stored_commit_was_settled_to_unknown_by_a_later_beacon_keeps_the_stored_commit_and_reports_the_label_change", () => {
    // Scenario: DiskNow "abc" (position 0), a script that may write at second 20 (position 1, Derived "abc", behind a roadblock), a git commit "zzz" at second 10 (position 2).
    const events = [makeDiskNowEvent(TEXT_ABC), makeMayWriteScriptEvent(20), makeGitCommitEvent(10, "zzz")];
    // The git commit text "zzz" differs from the carried text "abc", so the replay settles position 1 to Unknown.
    const storedCommits: WrittenCommit[] = [
        makeWrittenCommitForEvents(events, 0, StateConfidence.Proven, TEXT_ABC),
        { position: 1, confidence: StateConfidence.Derived, isFileAbsent: false, text: TEXT_ABC, eventType: FileEventType.ScriptMayWrite, moment: StateMoment.AtEvent },
        makeWrittenCommitForEvents(events, 2, StateConfidence.Proven, "zzz"),
    ];
    // Create the step with the three stored commits: it does not throw, so the stored commit at position 1 stays.
    const step = createFileStep(events, storedCommits);
    // Step once with no bound.
    const result = stepFileToNextTextChange(step, undefined);
    // Nothing is older, and the step reports that the label of position 1 changed to Unknown.
    assert.equal(result.outcome, InverseStepOutcome.NoOlderChange);
    assert.deepEqual(result.changedLabels, [{ position: 1, confidence: StateConfidence.Unknown }]);
});

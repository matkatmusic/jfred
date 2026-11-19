import { test } from "node:test";
import assert from "node:assert/strict";

import { GuessCategory } from "../src/structures/vocabulary.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { buildGuessReportText, type GuessReportEntry } from "../engineV3/engineV3_guess_files_report_text.ts";

function makeGuessState(confidence: StateConfidence, type: FileEventType, instant: Date | undefined): FileKnownState {
    const event = { type, instant, source: undefined, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined } as FileEvent;
    return { event, moment: StateMoment.AtEvent, confidence, isFileAbsent: false, text: undefined };
}

function makeEntry(relativePath: string, category: GuessCategory | undefined, guessStates: FileKnownState[] = [], otherPaths: string[] = []): GuessReportEntry {
    return { relativePath, category, guessStates, otherPaths };
}

test("test_the_report_starts_with_one_count_line_for_each_category_and_for_the_clear_walk", () => {
    // Scenario: two files with guess steps, one with no log lines, one clear.
    const entries = [makeEntry("a.ts", GuessCategory.HasGuessSteps), makeEntry("b.ts", GuessCategory.HasGuessSteps), makeEntry("c.ts", GuessCategory.NoLogLines), makeEntry("d.ts", undefined)];
    const lines = buildGuessReportText(entries).split("\n");
    // The first six lines are the counts, in the order of the categories, then the clear walk.
    assert.deepEqual(lines.slice(0, 6), ["No changing events: 0", "absent-at-start-commit: 0", "log-names-other-path: 0", "no-log-lines: 1", "has-guess-steps: 2", "clear walk: 1"]);
});

test("test_a_guess_step_file_lists_each_guess_state_under_it_with_confidence_event_type_and_instant", () => {
    // Scenario: one file with a derived state at an instant and an unknown state with no instant.
    const guessStates = [makeGuessState(StateConfidence.Derived, FileEventType.EditRow, new Date("2026-01-01T00:00:02.000Z")), makeGuessState(StateConfidence.Unknown, FileEventType.ScriptMayWrite, undefined)];
    const text = buildGuessReportText([makeEntry("src/a.ts", GuessCategory.HasGuessSteps, guessStates)]);
    // The file line is followed by one indented line for each state.
    assert.ok(text.includes("src/a.ts\n    derived EditRow 2026-01-01T00:00:02.000Z\n    unknown ScriptMayWrite no instant\n"));
});

test("test_a_log_names_other_path_file_lists_the_other_paths_under_it", () => {
    // Scenario: one file whose log lines name two other folders.
    const text = buildGuessReportText([makeEntry("src/a.ts", GuessCategory.LogNamesOtherPath, [], ["/w1/src/a.ts", "/w2/src/a.ts"])]);
    // Each other path is one indented line.
    assert.ok(text.includes("src/a.ts\n    other path /w1/src/a.ts\n    other path /w2/src/a.ts\n"));
});

test("test_the_no_changing_events_section_is_titled_No_changing_events", () => {
    // Scenario: one file in the no-changing-events category.
    const text = buildGuessReportText([makeEntry("r.ts", GuessCategory.NoChangingEvents)]);
    // The section title is the words, not the enum value.
    assert.ok(text.includes("== No changing events (1) ==\nr.ts\n"));
});

test("test_the_clear_walk_section_is_last_and_lists_one_file_for_each_line", () => {
    // Scenario: one clear file and one file with no log lines.
    const text = buildGuessReportText([makeEntry("clear.ts", undefined), makeEntry("lost.ts", GuessCategory.NoLogLines)]);
    // The clear walk section is at the end of the text.
    assert.ok(text.endsWith("== clear walk (1) ==\nclear.ts\n"));
    // The no-log-lines section holds its file.
    assert.ok(text.includes("== no-log-lines (1) ==\nlost.ts\n"));
});

// The marker box data of one file: its event instants, and the position of the file's time among them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MarkerDirection, JumpSpeed } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { computeMarkedPosition, findNewerColumnTime, listEventInstants } from "../engineV3/tui/engineV3_tui_marker_position.ts";
import type { ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { computeNextMarker, listEventsOfFile } from "../engineV3/tui/engineV3_tui_time_marker.ts";
import { makeInstant } from "./engineV3_step_test_projects.ts";

const FILE_A = new Path("/project/a.txt");
const FILE_B = new Path("/project/b.txt");

function makeEvent(file: Path, second: number): ProjectEventEntry {
    return { instant: makeInstant(second), file, eventType: FileEventType.EditRow, source: null };
}

// Events at seconds 30, 20, 10, newest first.
const EVENT_INSTANTS = [makeInstant(30), makeInstant(20), makeInstant(10)];
const NOW_INSTANT = makeInstant(40);

test("test_event_instants_are_distinct_and_newest_first", () => {
    // Scenario: events of one file at seconds 20, 20, 10 (two events share the second 20).
    const events = [makeEvent(FILE_A, 20), makeEvent(FILE_A, 20), makeEvent(FILE_A, 10)];
    // list the event instants.
    const instants = listEventInstants(events, NOW_INSTANT);
    // second 20 once, then second 10.
    assert.deepEqual(instants, [makeInstant(20), makeInstant(10)]);
});

test("test_event_instants_leave_out_instants_at_or_after_now", () => {
    // Scenario: events at seconds 45, 40, 30 and Now is second 40.
    const events = [makeEvent(FILE_A, 45), makeEvent(FILE_A, 40), makeEvent(FILE_A, 30)];
    // list the event instants with the Now time.
    const instants = listEventInstants(events, NOW_INSTANT);
    // only second 30 is older than Now: the [now] column already stands for seconds 40 and 45.
    assert.deepEqual(instants, [makeInstant(30)]);
});

test("test_each_right_press_moves_the_mark_one_column_when_the_newest_event_equals_now", () => {
    // Scenario: file A has events at seconds 40, 30, 20, 10. Now is second 40, the newest event of file A.
    const events = [makeEvent(FILE_A, 40), makeEvent(FILE_A, 30), makeEvent(FILE_A, 20), makeEvent(FILE_A, 10)];
    const eventsOfFileA = listEventsOfFile(events, FILE_A);
    const eventInstants = listEventInstants(eventsOfFileA, NOW_INSTANT);
    const bounds = { newest: NOW_INSTANT, oldest: makeInstant(10) };
    // the box has 3 event columns: the event at Now has no column of its own.
    assert.equal(eventInstants.length, 3);
    let fileTime = NOW_INSTANT;
    const markedPositions = [computeMarkedPosition(eventInstants, fileTime, bounds.newest)];
    for (let pressCount = 0; pressCount < 3; pressCount++) {
        const move = computeNextMarker(JumpSpeed.Event, eventsOfFileA, bounds, { instant: fileTime, eventIndex: undefined }, MarkerDirection.TowardsEarliest);
        fileTime = move.marker.instant;
        markedPositions.push(computeMarkedPosition(eventInstants, fileTime, bounds.newest));
    }
    // the mark moves 0, 1, 2, 3: no column is skipped.
    assert.deepEqual(markedPositions, [0, 1, 2, 3]);
});

test("test_each_right_press_at_event_speed_moves_the_mark_one_column_until_earliest", () => {
    // Scenario: file A has events at seconds 30, 20, 10; file B has newer events at seconds 40 and 35. Now is second 40.
    const events = [makeEvent(FILE_B, 40), makeEvent(FILE_B, 35), makeEvent(FILE_A, 30), makeEvent(FILE_A, 20), makeEvent(FILE_A, 10)];
    const eventsOfFileA = listEventsOfFile(events, FILE_A);
    const eventInstants = listEventInstants(eventsOfFileA, NOW_INSTANT);
    const bounds = { newest: NOW_INSTANT, oldest: makeInstant(10) };
    // the Right key steps the file time the way stepSelectedFiles does: the marker has no event index.
    let fileTime = NOW_INSTANT;
    const markedPositions = [computeMarkedPosition(eventInstants, fileTime, bounds.newest)];
    for (let pressCount = 0; pressCount < 4; pressCount++) {
        const move = computeNextMarker(JumpSpeed.Event, eventsOfFileA, bounds, { instant: fileTime, eventIndex: undefined }, MarkerDirection.TowardsEarliest);
        fileTime = move.marker.instant;
        markedPositions.push(computeMarkedPosition(eventInstants, fileTime, bounds.newest));
    }
    // the mark moves 0, 1, 2, 3 and stays at 3, the last position (Earliest), when Right can go no further.
    assert.deepEqual(markedPositions, [0, 1, 2, 3, 3]);
});

test("test_the_time_now_marks_position_0", () => {
    assert.equal(computeMarkedPosition(EVENT_INSTANTS, NOW_INSTANT, NOW_INSTANT), 0);
});

test("test_a_time_equal_to_an_event_marks_that_event", () => {
    // second 20 is the second event.
    assert.equal(computeMarkedPosition(EVENT_INSTANTS, makeInstant(20), NOW_INSTANT), 2);
});

test("test_a_time_between_two_events_marks_the_older_event", () => {
    // second 25 lies between the events at second 30 and second 20: the older is the second event.
    assert.equal(computeMarkedPosition(EVENT_INSTANTS, makeInstant(25), NOW_INSTANT), 2);
});

test("test_a_time_newer_than_the_newest_event_but_not_now_marks_position_1", () => {
    // second 35 is after the newest event (second 30) and before Now (second 40).
    assert.equal(computeMarkedPosition(EVENT_INSTANTS, makeInstant(35), NOW_INSTANT), 1);
});

test("test_a_time_older_than_the_oldest_event_marks_the_last_position", () => {
    // second 5 is before the oldest event: the marked position is the event count, 3.
    assert.equal(computeMarkedPosition(EVENT_INSTANTS, makeInstant(5), NOW_INSTANT), 3);
});

test("test_the_newer_column_of_position_0_does_not_exist", () => {
    // Scenario: the mark is at Now, the newest column.
    // there is no newer column.
    assert.equal(findNewerColumnTime(EVENT_INSTANTS, 0, NOW_INSTANT), undefined);
});

test("test_the_newer_column_of_position_1_is_now", () => {
    // Scenario: the mark is on the newest event (second 30); the column to its left is [now].
    // the newer column time is Now (second 40).
    assert.deepEqual(findNewerColumnTime(EVENT_INSTANTS, 1, NOW_INSTANT), NOW_INSTANT);
});

test("test_the_newer_column_of_position_2_is_the_newest_event", () => {
    // Scenario: the mark is on the second event (second 20); the column to its left is the newest event (second 30).
    assert.deepEqual(findNewerColumnTime(EVENT_INSTANTS, 2, NOW_INSTANT), makeInstant(30));
});

test("test_the_newer_column_of_the_last_position_is_the_event_before_it", () => {
    // Scenario: the mark is on the oldest event (second 10) at position 3; the column to its left is second 20.
    assert.deepEqual(findNewerColumnTime(EVENT_INSTANTS, 3, NOW_INSTANT), makeInstant(20));
});

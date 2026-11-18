// RED tests of Stage B4: the project time marker, the jump speed and the folded ruler rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { JumpSpeed, MarkerDirection } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { computeNextMarker, foldEventsIntoRulerRows, getNextNearestTimeStampEventForDirection, listEventsOfFile, toggleJumpSpeed, type MarkerBounds, type TimeMarker } from "../engineV3/tui/engineV3_tui_time_marker.ts";
import { makeInstant } from "./engineV3_step_test_projects.ts";

const oneDay = 86_400_000;
const secondsPerDay = 86_400;

// A larger second is NEWER; every list below is written newest first.
function makeEntry(second: number, fileName: string): ProjectEventEntry {
    return { instant: makeInstant(second), file: new Path(`/project/${fileName}`), eventType: FileEventType.EditRow, source: null };
}

function makeThreeEventList(): ProjectEventEntry[] {
    return [makeEntry(30, "a.txt"), makeEntry(20, "b.txt"), makeEntry(10, "c.txt")];
}

function makeMarkerOnEvent(events: ProjectEventEntry[], eventIndex: number): TimeMarker {
    return { instant: events[eventIndex]!.instant, eventIndex };
}

function makeSpreadEventList(): { events: ProjectEventEntry[]; bounds: MarkerBounds } {
    const events = [makeEntry(20 * secondsPerDay, "a.txt"), makeEntry(10 * secondsPerDay, "b.txt"), makeEntry(0, "c.txt")];
    const bounds = { newest: events[0]!.instant, oldest: events[2]!.instant };
    return { events, bounds };
}

test("test_event_speed_towards_earliest_returns_the_file_of_the_event_it_lands_on", () => {
    // Scenario: three events, marker on the newest. Step towards earliest twice, then back towards now once.
    const events = makeThreeEventList();
    const bounds = { newest: events[0]!.instant, oldest: events[2]!.instant };
    // the marker steps from index 0 to index 1 and names that event's file
    const firstMove = computeNextMarker(JumpSpeed.Event, events, bounds, makeMarkerOnEvent(events, 0), MarkerDirection.TowardsEarliest);
    assert.equal(firstMove.marker.eventIndex, 1);
    assert.equal(firstMove.marker.instant.getTime(), events[1]!.instant.getTime());
    assert.equal(firstMove.steppedFile?.value, "/project/b.txt");
    // the marker steps from index 1 to index 2
    const secondMove = computeNextMarker(JumpSpeed.Event, events, bounds, firstMove.marker, MarkerDirection.TowardsEarliest);
    assert.equal(secondMove.marker.eventIndex, 2);
    assert.equal(secondMove.steppedFile?.value, "/project/c.txt");
    // towards now from index 2 goes back to index 1
    const backMove = computeNextMarker(JumpSpeed.Event, events, bounds, secondMove.marker, MarkerDirection.TowardsNow);
    assert.equal(backMove.marker.eventIndex, 1);
    assert.equal(backMove.steppedFile?.value, "/project/b.txt");
});

test("test_event_speed_stops_at_the_last_event_and_at_the_first_event", () => {
    // Scenario: at either end of the list the marker does not move.
    const events = makeThreeEventList();
    const bounds = { newest: events[0]!.instant, oldest: events[2]!.instant };
    // the finder returns undefined past the oldest event
    const oldestMarker = makeMarkerOnEvent(events, 2);
    assert.equal(getNextNearestTimeStampEventForDirection(events, oldestMarker, MarkerDirection.TowardsEarliest), undefined);
    // the same marker comes back and no file steps
    const stuckAtOldest = computeNextMarker(JumpSpeed.Event, events, bounds, oldestMarker, MarkerDirection.TowardsEarliest);
    assert.deepEqual(stuckAtOldest.marker, oldestMarker);
    assert.equal(stuckAtOldest.steppedFile, undefined);
    // the finder returns undefined past the newest event
    const newestMarker = makeMarkerOnEvent(events, 0);
    assert.equal(getNextNearestTimeStampEventForDirection(events, newestMarker, MarkerDirection.TowardsNow), undefined);
    const stuckAtNewest = computeNextMarker(JumpSpeed.Event, events, bounds, newestMarker, MarkerDirection.TowardsNow);
    assert.deepEqual(stuckAtNewest.marker, newestMarker);
    assert.equal(stuckAtNewest.steppedFile, undefined);
});

test("test_events_with_one_instant_are_separate_steps_one_file_each", () => {
    // Scenario: two events share one instant. Each is its own step and names its own file.
    const events = [makeEntry(30, "a.txt"), makeEntry(20, "b.txt"), makeEntry(20, "c.txt"), makeEntry(10, "d.txt")];
    const bounds = { newest: events[0]!.instant, oldest: events[3]!.instant };
    // step onto the first of the two
    const toFirstShared = computeNextMarker(JumpSpeed.Event, events, bounds, makeMarkerOnEvent(events, 0), MarkerDirection.TowardsEarliest);
    assert.equal(toFirstShared.marker.eventIndex, 1);
    assert.equal(toFirstShared.steppedFile?.value, "/project/b.txt");
    // the next step stays on the same instant and names the second file
    const toSecondShared = computeNextMarker(JumpSpeed.Event, events, bounds, toFirstShared.marker, MarkerDirection.TowardsEarliest);
    assert.equal(toSecondShared.marker.eventIndex, 2);
    assert.equal(toSecondShared.marker.instant.getTime(), toFirstShared.marker.instant.getTime());
    assert.equal(toSecondShared.steppedFile?.value, "/project/c.txt");
    // the step after that leaves the shared instant
    const pastShared = computeNextMarker(JumpSpeed.Event, events, bounds, toSecondShared.marker, MarkerDirection.TowardsEarliest);
    assert.equal(pastShared.marker.eventIndex, 3);
    assert.equal(pastShared.steppedFile?.value, "/project/d.txt");
});

test("test_event_speed_from_a_marker_between_events_lands_on_the_next_older_or_newer_event", () => {
    // Scenario: the marker has no event index. Towards earliest lands on the first STRICTLY older event. Towards now lands on the last STRICTLY newer event.
    const events = [makeEntry(30, "a.txt"), makeEntry(20, "b.txt"), makeEntry(20, "c.txt"), makeEntry(10, "d.txt")];
    const bounds = { newest: events[0]!.instant, oldest: events[3]!.instant };
    // a marker at second 25 sits between index 0 and index 1
    const betweenMarker: TimeMarker = { instant: makeInstant(25), eventIndex: undefined };
    const olderMove = computeNextMarker(JumpSpeed.Event, events, bounds, betweenMarker, MarkerDirection.TowardsEarliest);
    assert.equal(olderMove.marker.eventIndex, 1);
    assert.equal(olderMove.steppedFile?.value, "/project/b.txt");
    const newerMove = computeNextMarker(JumpSpeed.Event, events, bounds, betweenMarker, MarkerDirection.TowardsNow);
    assert.equal(newerMove.marker.eventIndex, 0);
    assert.equal(newerMove.steppedFile?.value, "/project/a.txt");
    // a marker at second 20 with no index skips both events of second 20 (not strictly older or newer)
    const onSharedInstantMarker: TimeMarker = { instant: makeInstant(20), eventIndex: undefined };
    const skipOlder = computeNextMarker(JumpSpeed.Event, events, bounds, onSharedInstantMarker, MarkerDirection.TowardsEarliest);
    assert.equal(skipOlder.marker.eventIndex, 3);
    const skipNewer = computeNextMarker(JumpSpeed.Event, events, bounds, onSharedInstantMarker, MarkerDirection.TowardsNow);
    assert.equal(skipNewer.marker.eventIndex, 0);
});

test("test_day_speed_moves_the_marker_by_exactly_one_day_and_leaves_no_event_index", () => {
    // Scenario: the marker sits on the middle event. One day towards earliest is exactly 86 400 000 ms earlier.
    const { events, bounds } = makeSpreadEventList();
    const startMarker = makeMarkerOnEvent(events, 1);
    const move = computeNextMarker(JumpSpeed.Day, events, bounds, startMarker, MarkerDirection.TowardsEarliest);
    assert.equal(startMarker.instant.getTime() - move.marker.instant.getTime(), oneDay);
    assert.equal(move.marker.eventIndex, undefined);
});

test("test_week_speed_moves_the_marker_by_exactly_seven_days", () => {
    // Scenario: the marker sits on the middle event. One week towards earliest is exactly seven days earlier. One week towards now is exactly seven days later.
    const { events, bounds } = makeSpreadEventList();
    const startMarker = makeMarkerOnEvent(events, 1);
    const earlierMove = computeNextMarker(JumpSpeed.Week, events, bounds, startMarker, MarkerDirection.TowardsEarliest);
    assert.equal(startMarker.instant.getTime() - earlierMove.marker.instant.getTime(), 7 * oneDay);
    assert.equal(earlierMove.marker.eventIndex, undefined);
    const laterMove = computeNextMarker(JumpSpeed.Week, events, bounds, startMarker, MarkerDirection.TowardsNow);
    assert.equal(laterMove.marker.instant.getTime() - startMarker.instant.getTime(), 7 * oneDay);
    assert.equal(laterMove.marker.eventIndex, undefined);
});

test("test_day_speed_towards_now_adds_and_towards_earliest_subtracts", () => {
    // Scenario: from the middle event, towards now adds one day and towards earliest subtracts one day.
    const { events, bounds } = makeSpreadEventList();
    const startMarker = makeMarkerOnEvent(events, 1);
    const towardsNow = computeNextMarker(JumpSpeed.Day, events, bounds, startMarker, MarkerDirection.TowardsNow);
    assert.equal(towardsNow.marker.instant.getTime(), startMarker.instant.getTime() + oneDay);
    const towardsEarliest = computeNextMarker(JumpSpeed.Day, events, bounds, startMarker, MarkerDirection.TowardsEarliest);
    assert.equal(towardsEarliest.marker.instant.getTime(), startMarker.instant.getTime() - oneDay);
});

test("test_day_speed_is_clamped_to_the_newest_and_the_oldest_event", () => {
    // Scenario: a day step never leaves the range from the oldest event to the newest event.
    const { events, bounds } = makeSpreadEventList();
    // half a day below the newest, one day towards now stops at the newest
    const nearNewestMarker: TimeMarker = { instant: new Date(bounds.newest.getTime() - oneDay / 2), eventIndex: undefined };
    const clampedNewest = computeNextMarker(JumpSpeed.Day, events, bounds, nearNewestMarker, MarkerDirection.TowardsNow);
    assert.equal(clampedNewest.marker.instant.getTime(), bounds.newest.getTime());
    // half a day above the oldest, one day towards earliest stops at the oldest
    const nearOldestMarker: TimeMarker = { instant: new Date(bounds.oldest.getTime() + oneDay / 2), eventIndex: undefined };
    const clampedOldest = computeNextMarker(JumpSpeed.Day, events, bounds, nearOldestMarker, MarkerDirection.TowardsEarliest);
    assert.equal(clampedOldest.marker.instant.getTime(), bounds.oldest.getTime());
    // a week step is clamped the same way
    const clampedWeek = computeNextMarker(JumpSpeed.Week, events, bounds, nearNewestMarker, MarkerDirection.TowardsNow);
    assert.equal(clampedWeek.marker.instant.getTime(), bounds.newest.getTime());
});

test("test_day_and_week_moves_name_no_stepped_file", () => {
    // Scenario: a day or week move names no file, because every file may need to walk.
    const { events, bounds } = makeSpreadEventList();
    const startMarker = makeMarkerOnEvent(events, 1);
    const dayMove = computeNextMarker(JumpSpeed.Day, events, bounds, startMarker, MarkerDirection.TowardsNow);
    assert.equal(dayMove.steppedFile, undefined);
    const weekMove = computeNextMarker(JumpSpeed.Week, events, bounds, startMarker, MarkerDirection.TowardsEarliest);
    assert.equal(weekMove.steppedFile, undefined);
});

test("test_toggleJumpSpeed_turns_day_on_then_off_and_week_on_then_off", () => {
    // Scenario: pressing the key of the speed that is on turns it off (back to Event). Pressing it when off turns it on.
    assert.equal(toggleJumpSpeed(JumpSpeed.Event, JumpSpeed.Day), JumpSpeed.Day);
    assert.equal(toggleJumpSpeed(JumpSpeed.Day, JumpSpeed.Day), JumpSpeed.Event);
    assert.equal(toggleJumpSpeed(JumpSpeed.Event, JumpSpeed.Week), JumpSpeed.Week);
    assert.equal(toggleJumpSpeed(JumpSpeed.Week, JumpSpeed.Week), JumpSpeed.Event);
});

test("test_toggleJumpSpeed_week_replaces_day", () => {
    // Scenario: pressing the other key switches straight to that speed, both ways.
    assert.equal(toggleJumpSpeed(JumpSpeed.Day, JumpSpeed.Week), JumpSpeed.Week);
    assert.equal(toggleJumpSpeed(JumpSpeed.Week, JumpSpeed.Day), JumpSpeed.Day);
});

function makeManyEvents(eventCount: number): ProjectEventEntry[] {
    const events: ProjectEventEntry[] = [];
    for (let second = eventCount; second >= 1; second -= 1) {
        events.push(makeEntry(second, `file${second % 7}.txt`));
    }
    return events;
}

test("test_fold_keeps_every_event_exactly_once", () => {
    // Scenario: 500 events fold into at most 200 rows. Every event instant appears in exactly one row.
    const events = makeManyEvents(500);
    const rows = foldEventsIntoRulerRows(events, 200);
    // collect every instant of every row
    const foldedInstants = rows.flatMap((row) => row.instants).sort();
    const expectedInstants = events.map((event) => event.instant.toISOString()).sort();
    // same count, and the same list: no event lost and none repeated
    assert.equal(foldedInstants.length, 500);
    assert.deepEqual(foldedInstants, expectedInstants);
});

test("test_fold_rows_hold_instants_oldest_first", () => {
    // Scenario: inside one row the instants run from the oldest to the newest.
    const events = makeManyEvents(500);
    const rows = foldEventsIntoRulerRows(events, 200);
    for (const row of rows) {
        const sortedInstants = [...row.instants].sort();
        assert.deepEqual(row.instants, sortedInstants);
    }
});

test("test_fold_never_makes_more_rows_than_the_limit", () => {
    // Scenario: 500 events and a limit of 200 give at most 200 rows. Fewer events than the limit still keep every event.
    const manyRows = foldEventsIntoRulerRows(makeManyEvents(500), 200);
    assert.ok(manyRows.length <= 200);
    assert.ok(manyRows.length > 0);
    const fewRows = foldEventsIntoRulerRows(makeManyEvents(5), 200);
    assert.ok(fewRows.length <= 200);
    assert.equal(fewRows.flatMap((row) => row.instants).length, 5);
});

test("test_listEventsOfFile_holds_only_that_files_events_newest_first", () => {
    // Scenario: a mixed list. The result holds only the events of the asked file, in the list's newest-first order.
    const events = [makeEntry(50, "a.txt"), makeEntry(40, "b.txt"), makeEntry(30, "a.txt"), makeEntry(20, "c.txt"), makeEntry(10, "a.txt")];
    const result = listEventsOfFile(events, new Path("/project/a.txt"));
    assert.equal(result.length, 3);
    assert.ok(result.every((entry) => entry.file.value === "/project/a.txt"));
    assert.deepEqual(result.map((entry) => entry.instant.getTime()), [makeInstant(50).getTime(), makeInstant(30).getTime(), makeInstant(10).getTime()]);
});

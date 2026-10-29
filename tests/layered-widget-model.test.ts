// Widget models and ruler maths for the layered page.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildFileWidgetModels,
    extractBasename,
    findExtremeInstant,
    listSessionBasenames,
    measureAxisOffsetPx,
    type WireLayeredGraph,
} from "../webapp/layered-widget-model.ts";

const EARLY = "2026-07-25T10:00:00.000Z";
const LATE = "2026-07-25T10:05:00.000Z";

function describeGraph(): WireLayeredGraph {
    const lateEntity = {
        filename: "/w/late.py",
        sessionTimelines: [{ sessionFile: "/p/b.jsonl", timeline: { nodes: [{ kind: "beacon", instant: LATE }] } }],
        corroboratedInstants: [],
    };
    const earlyEntity = {
        filename: "/w/early.py",
        sessionTimelines: [{ sessionFile: "/p/a.jsonl", timeline: { nodes: [{ kind: "beacon", instant: EARLY }] } }],
        corroboratedInstants: [LATE],
    };
    const undatedEntity = { filename: "/w/undated.py", sessionTimelines: [], corroboratedInstants: [] };
    return { entities: [undatedEntity, lateEntity, earlyEntity], axisOffsetsPx: { [EARLY]: 0, [LATE]: 12.5 } };
}

test("test_extractBasename_returns_last_segment", () => {
    // Scenario: the lane label is the last path segment.
    assert.equal(extractBasename("/p/a.jsonl"), "a.jsonl");
    assert.equal(extractBasename("a.jsonl"), "a.jsonl");
});

test("test_findExtremeInstant_picks_earliest_or_latest", () => {
    // Scenario: one scan finds the earliest or the latest date.
    const dates = [new Date(LATE), new Date(EARLY)];
    assert.equal(findExtremeInstant(dates, false)?.toISOString(), EARLY);
    assert.equal(findExtremeInstant(dates, true)?.toISOString(), LATE);
    assert.equal(findExtremeInstant([], false), undefined);
});

test("test_measureAxisOffsetPx_pins_missing_ends_to_origin", () => {
    // Scenario: the offset is the ruler difference, 0 when an end is missing.
    const offsets = { [EARLY]: 0, [LATE]: 12.5 };
    assert.equal(measureAxisOffsetPx(new Date(LATE), new Date(EARLY), offsets), 12.5);
    assert.equal(measureAxisOffsetPx(undefined, new Date(EARLY), offsets), 0);
    assert.equal(measureAxisOffsetPx(new Date(LATE), undefined, offsets), 0);
});

test("test_buildFileWidgetModels_orders_by_start_with_undated_last", () => {
    // Scenario: widgets sort by history start; undated files go last.
    const models = buildFileWidgetModels(describeGraph());
    assert.deepEqual(models.map((model) => model.fileName), ["/w/early.py", "/w/late.py", "/w/undated.py"]);
    assert.equal(models[0]?.corroboratedInstants[0]?.toISOString(), LATE);
});

test("test_listSessionBasenames_lists_distinct_in_first_seen_order", () => {
    // Scenario: each session is listed once.
    assert.deepEqual(listSessionBasenames(describeGraph()), ["b.jsonl", "a.jsonl"]);
});

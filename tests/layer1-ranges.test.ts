// Task 292: where a session's band lands on the S18 axis.
//
// The interpolation is the only real risk here. The ruler is CAPPED and FLOORED, so time and pixels are not proportional — an instant halfway between two ticks in TIME is halfway between them in PIXELS, and computing it from the instant alone would put it somewhere else entirely.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSessionRanges, resolveAxisPixelsAt } from "../webapp/layer1-ranges.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireRulerTick, WireSession } from "../webapp/layer1-wire.ts";

// Two ticks one hour apart in TIME and 100 px apart on the AXIS — a gap the cap has squashed, which is exactly the case a time-proportional reading would get wrong.
const FIRST_TICK_INSTANT = "2026-06-01T10:00:00Z";
const LAST_TICK_INSTANT = "2026-06-01T11:00:00Z";
const TICKS: WireRulerTick[] = [
    { instant: FIRST_TICK_INSTANT, axisPx: 20, eventCount: 1 },
    { instant: LAST_TICK_INSTANT, axisPx: 120, eventCount: 1 },
];

function buildSession(started: string, ended: string): WireSession {
    return { file: "a.jsonl", fullPath: "/p/a.jsonl", title: "t", started, ended, paths: [] };
}

test("an instant halfway between two ticks lands halfway between their offsets", () => {
    assert.equal(resolveAxisPixelsAt(Date.parse("2026-06-01T10:30:00Z"), TICKS), 70);
});

test("an instant on a tick takes that tick's own offset", () => {
    assert.equal(resolveAxisPixelsAt(Date.parse(FIRST_TICK_INSTANT), TICKS), 20);
    assert.equal(resolveAxisPixelsAt(Date.parse(LAST_TICK_INSTANT), TICKS), 120);
});

test("instants outside the ruler clamp to its ends", () => {
    // A session that opened before the first recorded event still has to start somewhere on screen.
    assert.equal(resolveAxisPixelsAt(Date.parse("2026-05-01T00:00:00Z"), TICKS), 20);
    assert.equal(resolveAxisPixelsAt(Date.parse("2026-08-01T00:00:00Z"), TICKS), 120);
});

test("a session that covers no event gets a bar and no wash", () => {
    setupLayer1Dom();
    // Wholly inside the gap between the two ticks, so there is nothing for a wash to close on.
    renderSessionRanges([buildSession("2026-06-01T10:10:00Z", "2026-06-01T10:20:00Z")], TICKS);
    assert.equal(document.querySelectorAll("#ranges .range").length, 1);
    assert.equal(document.querySelectorAll("#washes .range-wash").length, 0);
});

test("a covering session's wash closes half a node row clear of the events it reaches", () => {
    setupLayer1Dom();
    renderSessionRanges([buildSession("2026-06-01T09:00:00Z", "2026-06-01T12:00:00Z")], TICKS);
    const wash = document.querySelector("#washes .range-wash") as HTMLElement;
    // RULER_NODE_ROW_PIXELS is 22, so half a row is 11: 20 - 11 = 9, and 120 + 11 - 9 = 122.
    assert.equal(wash.style.getPropertyValue("--axis-px"), "9");
    assert.equal(wash.style.getPropertyValue("--span-px"), "122");
});

test("a gutter row inside a picked session's band is marked", () => {
    setupLayer1Dom();
    const ruler = document.getElementById("ruler")!;
    const insideTick = document.createElement("div");
    insideTick.className = "tick";
    insideTick.style.setProperty("--axis-px", "20");
    const outsideTick = document.createElement("div");
    outsideTick.className = "tick";
    outsideTick.style.setProperty("--axis-px", "120");
    ruler.append(insideTick, outsideTick);

    // Opens before the first tick and closes on the gap, so it covers the first row and not the last.
    renderSessionRanges([buildSession("2026-06-01T09:00:00Z", "2026-06-01T10:30:00Z")], TICKS);

    assert.ok(insideTick.classList.contains("inrange"));
    assert.equal(outsideTick.classList.contains("inrange"), false);
});

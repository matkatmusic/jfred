// Task 292: where a session's band lands on the capped, floored S18 axis, so time is not pixels.

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSessionRanges, computeAxisPixelsAt } from "../webapp/layer1-ranges.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireRulerTick, WireSession } from "../webapp/layer1-wire.ts";

// Two ticks one hour apart in time and 100 px apart on the axis: a squashed gap.
const FIRST_TICK_INSTANT = "2026-06-01T10:00:00Z";
const LAST_TICK_INSTANT = "2026-06-01T11:00:00Z";
const TICKS: WireRulerTick[] = [
    { instant: FIRST_TICK_INSTANT, axisPx: 20, eventCount: 1 },
    { instant: LAST_TICK_INSTANT, axisPx: 120, eventCount: 1 },
];

function buildSession(started: string, ended: string): WireSession {
    return { file: "a.jsonl", fullPath: "/p/a.jsonl", titles: ["t"], started, ended, paths: [] };
}

test("an instant halfway between two ticks lands halfway between their offsets", () => {
    assert.equal(computeAxisPixelsAt(Date.parse("2026-06-01T10:30:00Z"), TICKS), 70);
});

test("an instant on a tick takes that tick's own offset", () => {
    assert.equal(computeAxisPixelsAt(Date.parse(FIRST_TICK_INSTANT), TICKS), 20);
    assert.equal(computeAxisPixelsAt(Date.parse(LAST_TICK_INSTANT), TICKS), 120);
});

test("instants outside the ruler clamp to its ends", () => {
    // A session that opened before the first recorded event still has to start somewhere on screen.
    assert.equal(computeAxisPixelsAt(Date.parse("2026-05-01T00:00:00Z"), TICKS), 20);
    assert.equal(computeAxisPixelsAt(Date.parse("2026-08-01T00:00:00Z"), TICKS), 120);
});

test("a session that covers no event gets a bar and no wash", () => {
    initLayer1Dom();
    // Wholly inside the gap between the two ticks, so there is nothing for a wash to close on.
    renderSessionRanges([buildSession("2026-06-01T10:10:00Z", "2026-06-01T10:20:00Z")], TICKS);
    assert.equal(document.querySelectorAll("#ranges .range").length, 1);
    assert.equal(document.querySelectorAll("#washes .range-wash").length, 0);
});

test("a covering session's wash closes half a node row clear of the events it reaches", () => {
    initLayer1Dom();
    renderSessionRanges([buildSession("2026-06-01T09:00:00Z", "2026-06-01T12:00:00Z")], TICKS);
    const wash = document.querySelector("#washes .range-wash") as HTMLElement;
    // Row height 22 px; the wash starts half a row early and ends half a row late.
    assert.equal(wash.style.getPropertyValue("--axis-px"), "9");
    assert.equal(wash.style.getPropertyValue("--span-px"), "122");
});

test("a gutter row inside a picked session's band is marked", () => {
    initLayer1Dom();
    const ruler = document.getElementById("ruler")!;
    const insideTick = document.createElement("div");
    insideTick.className = "tick";
    insideTick.style.setProperty("--axis-px", "20");
    const outsideTick = document.createElement("div");
    outsideTick.className = "tick";
    outsideTick.style.setProperty("--axis-px", "120");
    ruler.append(insideTick, outsideTick);

    // Opens before the first tick and closes in the gap: first row only.
    renderSessionRanges([buildSession("2026-06-01T09:00:00Z", "2026-06-01T10:30:00Z")], TICKS);

    assert.ok(insideTick.classList.contains("inrange"));
    assert.equal(outsideTick.classList.contains("inrange"), false);
});

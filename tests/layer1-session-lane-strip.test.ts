// Task 901: the sideways scroll strip pinned under the capped session column.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { createElement } = await import("../webapp/app-dom.ts");
const { buildLaneStrip, renderLaneStrip, LANE_STRIP_ID } = await import("../webapp/layer1-components/session-column/layer1-session-lane-strip.ts");

function buildTrackWithStrip(scrollWidth: number, clientWidth: number): HTMLElement {
    const track = createElement("div", { id: "sessionDotLinesComponent" });
    const strip = buildLaneStrip();
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(strip, "clientWidth", { configurable: true, value: clientWidth });
    Object.defineProperty(strip, "scrollLeft", { configurable: true, writable: true, value: 0 });
    track.append(strip);
    document.body.append(track);
    return track;
}

function readStrip(): HTMLElement {
    return document.getElementById(LANE_STRIP_ID)!;
}

test("test_the_strip_is_needed_when_the_lanes_are_wider_than_the_strip", () => {
    // Steps: build a column whose lanes (261) are wider than the strip (227), render the strip, check it is marked needed.
    const track = buildTrackWithStrip(261, 227);
    try {
        renderLaneStrip();
        assert.equal(readStrip().classList.contains("is-needed"), true);
    } finally {
        track.remove();
    }
});

test("test_the_strip_is_not_needed_when_the_lanes_fit", () => {
    // Steps: build a column whose lanes (227) are exactly as wide as the strip (227), render the strip, check it is not marked needed.
    const track = buildTrackWithStrip(227, 227);
    try {
        renderLaneStrip();
        assert.equal(readStrip().classList.contains("is-needed"), false);
    } finally {
        track.remove();
    }
});

test("test_scrolling_the_strip_moves_the_lanes_of_the_column", () => {
    // Steps: build a wide strip, scroll it 34 pixels, send the scroll event, check the column copied the shift.
    const track = buildTrackWithStrip(261, 227);
    try {
        const strip = readStrip();
        strip.scrollLeft = 34;
        strip.dispatchEvent(new window.Event("scroll"));
        assert.equal(track.style.getPropertyValue("--lane-shift"), "34px");
    } finally {
        track.remove();
    }
});

test("test_lanes_go_back_to_the_start_when_the_strip_is_no_longer_needed", () => {
    // Steps: build a wide strip, scroll it 34 pixels so the shift is 34px, then make the lanes fit, render, check shift and scroll are reset.
    const track = buildTrackWithStrip(261, 227);
    try {
        const strip = readStrip();
        strip.scrollLeft = 34;
        strip.dispatchEvent(new window.Event("scroll"));
        assert.equal(track.style.getPropertyValue("--lane-shift"), "34px");
        Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 227 });
        renderLaneStrip();
        assert.equal(track.style.getPropertyValue("--lane-shift"), "0px");
        assert.equal(strip.scrollLeft, 0);
    } finally {
        track.remove();
    }
});

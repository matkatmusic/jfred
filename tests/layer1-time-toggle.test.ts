// The Layer 1 committer/author toggle, tested against the real layer1.html markup.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { TIME_SOURCE_VALUES, readTimeSource } from "../webapp/layer1-sources.ts";
import { registerTimeSourceToggle } from "../webapp/layer1-time-toggle.ts";

function readCurrentButtonIds(): string[] {
    return Array.from(document.querySelectorAll("button.current[id^='time-']"), (button) => button.id);
}

test("test_registerTimeSourceToggle_marks_the_seeded_source_current", () => {
    initLayer1Dom();
    registerTimeSourceToggle(() => {});
    assert.deepEqual(readCurrentButtonIds(), [`time-${readTimeSource()}`]);
});

test("test_registerTimeSourceToggle_click_selects_marks_and_calls_back", () => {
    initLayer1Dom();
    let callbackCount = 0;
    registerTimeSourceToggle(() => {
        callbackCount++;
    });
    const otherValue = TIME_SOURCE_VALUES.find((value) => value !== readTimeSource())!;
    (document.getElementById(`time-${otherValue}`) as HTMLElement).click();
    assert.equal(readTimeSource(), otherValue);
    assert.deepEqual(readCurrentButtonIds(), [`time-${otherValue}`]);
    assert.equal(callbackCount, 1);
});

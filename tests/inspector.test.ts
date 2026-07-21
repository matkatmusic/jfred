// The task-141 nav counter: 0-based index plus the full index range, never readable as
// "index over count". webapp/inspector.ts imports DOM-touching modules, so the happy-dom
// globals are installed before the dynamic import (the app-header.test.ts pattern).

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_formatInspectorLineCounter_names_the_zero_based_index_range", async () => {
    // Scenario (task 141): "line 0 / 98" was ambiguous (count or max index?); the label now
    // shows the 0-based index AND the inclusive index range of a 99-line transcript.
    setupWebappDom();
    const { formatInspectorLineCounter } = await import("../webapp/inspector.ts");
    assert.equal(formatInspectorLineCounter(0, 99), "line 0 of 0–98");
    assert.equal(formatInspectorLineCounter(98, 99), "line 98 of 0–98");
});

test("test_inspector_nav_disabled_states_at_ends_and_middle", async () => {
    // Scenario (task 142): the record stepper's Prev disables on line 0 and Next disables on
    // the last line, instead of both staying enabled and clamping to a silent no-op.
    setupWebappDom();
    const { computeInspectorNavDisabledStates } = await import("../webapp/inspector.ts");
    // Step: at index 0 of 3 lines, Prev is disabled and Next is enabled.
    assert.deepEqual(computeInspectorNavDisabledStates(0, 3), { prevIsDisabled: true, nextIsDisabled: false });
    // Step: at the last index (2 of 3 lines), Next is disabled and Prev is enabled.
    assert.deepEqual(computeInspectorNavDisabledStates(2, 3), { prevIsDisabled: false, nextIsDisabled: true });
    // Step: in the middle, both are enabled.
    assert.deepEqual(computeInspectorNavDisabledStates(1, 3), { prevIsDisabled: false, nextIsDisabled: false });
    // Step: a single-line transcript disables both.
    assert.deepEqual(computeInspectorNavDisabledStates(0, 1), { prevIsDisabled: true, nextIsDisabled: true });
});

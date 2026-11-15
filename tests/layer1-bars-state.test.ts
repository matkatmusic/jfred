import assert from "node:assert/strict";
import { test } from "node:test";
import { createBarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";

test("test_a_new_state_selects_row_zero_with_the_fold_open_and_no_ruler_rows", () => {
    // Scenario: a fresh Bars view state starts at the newest row, fold open, nothing loaded.
    // Make a new state.
    const state = createBarsViewState();
    // It selects row 0.
    assert.equal(state.selectedRowIndex, 0);
    // The fold is shown.
    assert.equal(state.isFoldShown, true);
    // There are no ruler rows, no models and no row elements.
    assert.deepEqual(state.rulerRows, []);
    assert.deepEqual(state.models, []);
    assert.deepEqual(state.rowElements, []);
    // No load is needed, no history is loading, events are under the bar, and no dot is selected.
    assert.equal(state.runId, 0);
    assert.equal(state.isLoadNeeded, false);
    assert.equal(state.isHistoryLoading, false);
    assert.equal(state.isEventsInBar, false);
    assert.equal(state.projectDir, "");
    assert.equal(state.selectedDotElement, undefined);
    // No ruler refresh is waiting.
    assert.equal(state.isRulerRefreshNeeded, false);
});

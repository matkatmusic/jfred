// The row split of the screen while a drawer (View File or Engine Console) is open.

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDrawerLayout } from "../engineV3/tui/engineV3_tui_drawer_layout.ts";

test("test_the_info_box_starts_at_the_halfway_row_and_the_drawer_fills_the_rest", () => {
    // Scenario: 40 rows, an info box of 5 rows, a hotkeys box of 4 rows.
    const layout = computeDrawerLayout(40, 5, 4);
    // the rows above the info box are 20, the drawer takes 40 - 20 - 5 - 4 = 11 rows.
    assert.equal(layout.aboveInfoRowCount, 20);
    assert.equal(layout.drawerRowCount, 11);
});

test("test_an_odd_row_count_rounds_the_halfway_row_down", () => {
    // Scenario: 41 rows.
    const layout = computeDrawerLayout(41, 5, 4);
    // 20 rows above the info box and 12 for the drawer.
    assert.equal(layout.aboveInfoRowCount, 20);
    assert.equal(layout.drawerRowCount, 12);
});

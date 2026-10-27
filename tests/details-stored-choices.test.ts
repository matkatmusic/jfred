import { test } from "node:test";
import assert from "node:assert/strict";
import { computeInitialFullContentsChoice, convertStoredDiffModeToToggle } from "../webapp/views/details-stored-choices.ts";
import { DiffDisplayMode } from "../webapp/diff-display-mode.ts";

test("test_convertStoredDiffModeToToggle_maps_split_to_columns", () => {
    // Step 1: the stored diff-vs-base vocabulary maps onto the fork toggle's labels.
    assert.equal(convertStoredDiffModeToToggle(DiffDisplayMode.split), "columns");
    assert.equal(convertStoredDiffModeToToggle(DiffDisplayMode.inline), "inline");
    // Step 2: nothing stored falls back to the split default, so Columns.
    assert.equal(convertStoredDiffModeToToggle(undefined), "columns");
});

test("test_computeInitialFullContentsChoice_reads_the_stored_flag", () => {
    // Step 1: "1" means the "Show full contents" toggle was left on.
    assert.equal(computeInitialFullContentsChoice("1"), true);
    // Step 2: absent, "0" or anything else means off, because full contents is opt-in.
    assert.equal(computeInitialFullContentsChoice(undefined), false);
    assert.equal(computeInitialFullContentsChoice("0"), false);
    assert.equal(computeInitialFullContentsChoice("columns"), false);
});

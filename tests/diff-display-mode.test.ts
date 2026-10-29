import { test } from "node:test";
import assert from "node:assert/strict";
import { DiffDisplayMode, computeInitialDiffDisplayMode } from "../webapp/diff-display-mode.ts";

test("test_computeInitialDiffDisplayMode_returns_stored_mode", () => {
    // A stored preference must survive a reload (item 10f).
    assert.equal(computeInitialDiffDisplayMode("inline"), DiffDisplayMode.inline);
});

test("test_computeInitialDiffDisplayMode_defaults_to_split", () => {
    // Nothing stored, or a value from an older build, must not leave the toggle in no mode.
    assert.equal(computeInitialDiffDisplayMode(null), DiffDisplayMode.split);
    assert.equal(computeInitialDiffDisplayMode("weird"), DiffDisplayMode.split);
});

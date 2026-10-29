// Per-file test for webapp/layer1-wire-edits.ts: the wire edit-kind, edit-side and confidence spellings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireConfidence, WireEditKind, WireEditSide } from "../webapp/layer1-wire-edits.ts";

test("test_WireEditKind_names_edit_write_and_read", () => {
    // Verify: the three tool kinds keep their wire spelling.
    assert.deepEqual(WireEditKind, { edit: "edit", write: "write", read: "read" });
});

test("test_WireEditSide_names_base_and_target", () => {
    // Verify: the two file sides keep their wire spelling.
    assert.deepEqual(WireEditSide, { base: "base", target: "target" });
});

test("test_WireConfidence_names_the_three_layer_3_states", () => {
    // Verify: only verified, derived and reseeded exist.
    assert.deepEqual(WireConfidence, { verified: "verified", derived: "derived", reseeded: "reseeded" });
});

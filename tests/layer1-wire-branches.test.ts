// Per-file test for webapp/layer1-wire-branches.ts: the wire rewind-kind spelling.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireRewindKind } from "../webapp/layer1-wire-branches.ts";

test("test_WireRewindKind_names_code_and_conversation", () => {
    // Verify: the two rewind kinds keep their wire spelling.
    assert.deepEqual(WireRewindKind, { code: "code", conversation: "conversation" });
});

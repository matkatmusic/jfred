// Smoke test: scripts/visual/layer3-drawer-checks.ts exports the three drawer checks.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { assertDerivedEdit, assertReadBeacon, assertVerifiedEdit } from "../scripts/visual/layer3-drawer-checks.ts";

test("the drawer checks are exported as functions", () => {
    assert.equal(typeof assertVerifiedEdit, "function");
    assert.equal(typeof assertDerivedEdit, "function");
    assert.equal(typeof assertReadBeacon, "function");
});

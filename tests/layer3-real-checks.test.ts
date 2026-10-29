// Smoke test: scripts/visual/layer3-real-checks.ts exports the real-server check runner.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { executeLayer3RealChecks } from "../scripts/visual/layer3-real-checks.ts";

test("executeLayer3RealChecks is exported as a function", () => {
    assert.equal(typeof executeLayer3RealChecks, "function");
});

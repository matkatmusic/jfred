// Tests for scripts/visual/ruler-ui-commit-checks.ts: the run order stays exported; judges are tested in ruler-ui-commit-judges.test.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as commit from "../scripts/visual/ruler-ui-commit-checks.ts";

test("test_commit_checks_export_validateRulerUi_and_no_judges", () => {
    // Step: the run entry point is a function; the judges are not forwarded from this module.
    assert.equal(typeof commit.validateRulerUi, "function");
    assert.equal("isStripPlaced" in commit, false);
});

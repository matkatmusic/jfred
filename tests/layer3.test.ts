// layer3.ts cannot be imported (top-level await); these test the failure tally its exit code reads.

import assert from "node:assert/strict";
import { test } from "node:test";
import { failures, reportCheck } from "../scripts/visual/mockup-checks.ts";

test("reportCheck adds a failed check name to failures and ignores a passed one", (context) => {
    context.mock.method(console, "log", () => {});
    const before = failures.length;
    reportCheck("#355 passes", true);
    reportCheck("#355 fails", false, 0);
    assert.deepEqual(failures.slice(before), ["#355 fails"]);
    failures.length = before;
});

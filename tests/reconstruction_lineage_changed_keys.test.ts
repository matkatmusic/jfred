// Changed state keys of a memoized execution, and their match against lineage paths.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getChangedStateKeysOnce, isAnyKeyOnLineagePath } from "../src/reconstruction_lineage_changed_keys.ts";
import type { RunExecution } from "../src/reconstruction_script_runs.ts";

test("getChangedStateKeysOnce lists changed, created, and deleted keys only", () => {
    const execution: RunExecution = {
        pre: new Map([["a.py", "1"], ["b.py", "2"], ["gone.py", "3"]]),
        post: new Map([["a.py", "1"], ["b.py", "changed"], ["new.py", "4"]]),
    };
    assert.deepEqual(getChangedStateKeysOnce(execution).sort(), ["b.py", "gone.py", "new.py"]);
});

test("getChangedStateKeysOnce returns no keys when the execution has no post state", () => {
    const execution: RunExecution = { pre: new Map([["a.py", "1"]]), post: undefined };
    assert.deepEqual(getChangedStateKeysOnce(execution), []);
});

test("getChangedStateKeysOnce returns the same array for the same execution", () => {
    const execution: RunExecution = { pre: new Map(), post: new Map([["a.py", "1"]]) };
    assert.equal(getChangedStateKeysOnce(execution), getChangedStateKeysOnce(execution));
});

test("isAnyKeyOnLineagePath matches an exact path or a path ending with /key", () => {
    assert.equal(isAnyKeyOnLineagePath(["billing.py"], ["billing.py"]), true);
    assert.equal(isAnyKeyOnLineagePath(["billing.py"], ["src/billing.py"]), true);
    assert.equal(isAnyKeyOnLineagePath(["billing.py"], ["src/mybilling.py"]), false);
    assert.equal(isAnyKeyOnLineagePath([], ["billing.py"]), false);
});

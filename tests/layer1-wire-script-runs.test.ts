// Per-file test for webapp/layer1-wire-script-runs.ts: the wire executor-kind spelling matches the engine's ScriptExecutorKind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { WireScriptExecutorKind } from "../webapp/layer1-wire-script-runs.ts";
import { ScriptExecutorKind } from "../src/reconstruction_script_execution.ts";

test("test_WireScriptExecutorKind_spells_every_engine_executor_kind_the_same", () => {
    // Verify: each engine kind value is a wire kind value, with no extras on either side.
    assert.deepEqual(Object.values(WireScriptExecutorKind).sort(), Object.values(ScriptExecutorKind).sort());
});

test("test_WireScriptExecutorKind_names_python_and_bash", () => {
    assert.equal(WireScriptExecutorKind.python, "python");
    assert.equal(WireScriptExecutorKind.bash, "bash");
});

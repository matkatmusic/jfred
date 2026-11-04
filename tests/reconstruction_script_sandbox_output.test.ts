import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSandboxInputKey, executeScriptAgainstState } from "../src/reconstruction_script_sandbox.ts";
import { getMemoizedSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";

function readStoredOutcome(script: string) {
    return getMemoizedSandboxOutcome(computeSandboxInputKey(script, new Map()));
}

test("test_executeScriptAgainstState_stores_output_for_a_success_a_crash_and_a_timeout", () => {
    const cases: [string, boolean, object][] = [
        ['import sys\nprint("hi")\nsys.stderr.write("warn")\n', true, { stdout: "hi\n", stderr: "warn", exitCode: 0, timedOut: false }],
        ['import sys\nprint("partial")\nsys.exit(3)\n', false, { stdout: "partial\n", stderr: "", exitCode: 3, timedOut: false }],
        ["import time\ntime.sleep(60)\n", false, { stdout: "", stderr: "", exitCode: undefined, timedOut: true }],
    ];
    for (const [script, isSuccess, output] of cases) {
        assert.equal(executeScriptAgainstState(script, new Map()) !== undefined, isSuccess);
        assert.deepEqual(readStoredOutcome(script)?.output, output);
    }
});

test("test_executeScriptAgainstState_stores_a_failure_for_output_that_is_too_large", () => {
    const script = 'print("x" * 3000000)\n';
    assert.equal(executeScriptAgainstState(script, new Map()), undefined);
    assert.equal(readStoredOutcome(script)?.output?.timedOut, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runScriptAgainstState } from "../src/reconstruction_script_sandbox.ts";
import { Path } from "../src/structures/domain.ts";
import { collectSandboxSpawnLabels } from "./script-execution-test-helpers.ts";

test("test_runScriptAgainstState_returns_files_the_script_creates", () => {
    // Scenario: the script writes a new file the pre-state never contained; the result includes it.  Steps: run a script that writes "out.txt" against an empty-but-nonempty pre-state.
    const script = 'open("out.txt", "w").write("created\\n")\n';
    const preState = new Map([["keep.py", "x = 1\n"]]);
    const result = runScriptAgainstState(script, preState);
    // assert the result map contains "out.txt" with the written content.
    assert.ok(result !== undefined);
    assert.equal(result!.get("out.txt"), "created\n");
});

test("test_runScriptAgainstState_remaps_recorded_cwd_into_sandbox", () => {
    // Scenario: a script hardcodes its RECORDED cwd as an absolute path literal (s87 step 57);
    // with the recorded cwd passed in, the sandbox must rewrite that literal to the sandbox dir
    // so the transform applies to the SANDBOX copy and the real recorded directory is untouched.
    // Steps:
    // create a real directory standing in for the recorded cwd, holding the same file the pre-state seeds.
    const recordedDir = mkdtempSync(join(tmpdir(), "reveng-recorded-"));
    try {
        writeFileSync(join(recordedDir, "demo.py"), "def add():\n    add()\n");
        // run a script that reads and rewrites the file VIA the absolute recorded path.
        const script =
            `import re\n` +
            `base = "${recordedDir}"\n` +
            `text = open(base + "/demo.py").read()\n` +
            `text = re.sub(r"\\badd\\b", "record", text)\n` +
            `open(base + "/demo.py", "w").write(text)\n`;
        const preState = new Map([["demo.py", "def add():\n    add()\n"]]);
        const result = runScriptAgainstState(script, preState, "", new Path(recordedDir));
        // assert the transform landed on the sandbox copy of the file.
        assert.ok(result !== undefined);
        assert.equal(result!.get("demo.py"), "def record():\n    record()\n");
        // assert the real recorded directory still holds the original content (no sandbox escape).
        assert.equal(readFileSync(join(recordedDir, "demo.py"), "utf8"), "def add():\n    add()\n");
    } finally {
        rmSync(recordedDir, { recursive: true, force: true });
    }
});

// runScriptAgainstState executes a script in a temp dir and returns modified file content.
test("test_runScriptAgainstState_applies_rename", () => {
    const script = `import re\ntext = open("demo.py").read()\ntext = re.sub(r"\\badd\\b", "record", text)\nopen("demo.py", "w").write(text)\n`;
    const preState = new Map([["demo.py", "def add():\n    add()"]]);
    const result = runScriptAgainstState(script, preState);
    assert.ok(result !== undefined);
    assert.equal(result!.get("demo.py"), "def record():\n    record()");
});

test("test_runScriptAgainstState_memoizes_identical_input", () => {
    // Scenario: two calls with byte-identical (script, seeded state) spawn ONE sandbox — the second returns the memoized outcome (s84 in logs1.txt asked 208 times for 14 distinct inputs; this memo is the fix).  Steps: run the same transform twice, counting spawn announcements.
    const preState = new Map([["data.txt", "before\n"]]);
    const script = 'open("data.txt", "w").write("after\\n")\n';
    let firstResult: Map<string, string> | undefined;
    let secondResult: Map<string, string> | undefined;
    const spawnLabels = collectSandboxSpawnLabels(() => {
        firstResult = runScriptAgainstState(script, preState);
        secondResult = runScriptAgainstState(script, preState);
    });
    // one spawn, the same result object back, and the transform is correct.
    assert.equal(spawnLabels.length, 1);
    assert.equal(secondResult, firstResult);
    assert.equal(firstResult?.get("data.txt"), "after\n");
});

test("test_runScriptAgainstState_distinguishes_seeded_content", () => {
    // Scenario: same script, different seeded CONTENT — the memo must key on content, never on path names or file counts.  Steps: run one appending script over two different seeds.
    const script = 'data = open("data.txt").read()\nopen("data.txt", "w").write(data + "x\\n")\n';
    const firstResult = runScriptAgainstState(script, new Map([["data.txt", "a\n"]]));
    const secondResult = runScriptAgainstState(script, new Map([["data.txt", "b\n"]]));
    // each seed got its own execution and its own correct output.
    assert.equal(firstResult?.get("data.txt"), "a\nx\n");
    assert.equal(secondResult?.get("data.txt"), "b\nx\n");
});

test("test_runScriptAgainstState_memoizes_failed_runs", () => {
    // Scenario: a failing script memoizes too — its repeats must not re-pay the spawn (or its 5-second timeout) for a run already known to fail.  Steps: run a script that exits nonzero, twice, counting spawn announcements.
    const preState = new Map([["data.txt", "x\n"]]);
    const script = "raise SystemExit(1)\n";
    let firstResult: Map<string, string> | undefined;
    let secondResult: Map<string, string> | undefined;
    const spawnLabels = collectSandboxSpawnLabels(() => {
        firstResult = runScriptAgainstState(script, preState);
        secondResult = runScriptAgainstState(script, preState);
    });
    // one spawn; both calls report the failure as undefined.
    assert.equal(spawnLabels.length, 1);
    assert.equal(firstResult, undefined);
    assert.equal(secondResult, undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { computeSandboxInputKey, executeScriptAgainstState } from "../src/reconstruction_script_sandbox.ts";
import { getMemoizedSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";
import { DockerUnavailableError, SANDBOX_IMAGE } from "../src/reconstruction_script_sandbox_docker.ts";
import { Path } from "../src/structures/domain.ts";
import { collectSandboxSpawnLabels } from "./script-execution-test-helpers.ts";

test("test_executeScriptAgainstState_returns_files_the_script_creates", () => {
    // Scenario: a script writes a new file the pre-state lacked; the result includes it.
    const script = 'open("out.txt", "w").write("created\\n")\n';
    const preState = new Map([["keep.py", "x = 1\n"]]);
    const result = executeScriptAgainstState(script, preState);
    // assert the result map contains "out.txt" with the written content.
    assert.ok(result !== undefined);
    assert.equal(result!.get("out.txt"), "created\n");
});

test("test_executeScriptAgainstState_mounts_the_sandbox_at_the_recorded_cwd", () => {
    // Docker mounts the sandbox copy AT the recorded cwd (no text swap), so the real directory stays untouched.
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
        const result = executeScriptAgainstState(script, preState, "", new Path(recordedDir));
        // assert the transform landed on the sandbox copy of the file.
        assert.ok(result !== undefined);
        assert.equal(result!.get("demo.py"), "def record():\n    record()\n");
        // assert the real recorded directory still holds the original content (no sandbox escape).
        assert.equal(readFileSync(join(recordedDir, "demo.py"), "utf8"), "def add():\n    add()\n");
    } finally {
        rmSync(recordedDir, { recursive: true, force: true });
    }
});

// executeScriptAgainstState executes a script in a temp dir and returns modified file content.
test("test_executeScriptAgainstState_applies_rename", () => {
    const script = `import re\ntext = open("demo.py").read()\ntext = re.sub(r"\\badd\\b", "record", text)\nopen("demo.py", "w").write(text)\n`;
    const preState = new Map([["demo.py", "def add():\n    add()"]]);
    const result = executeScriptAgainstState(script, preState);
    assert.ok(result !== undefined);
    assert.equal(result!.get("demo.py"), "def record():\n    record()");
});

test("test_executeScriptAgainstState_memoizes_identical_input", () => {
    // Scenario: two calls with identical script and seeded state spawn ONE sandbox; the second is memoized.
    const preState = new Map([["data.txt", "before\n"]]);
    const script = 'open("data.txt", "w").write("after\\n")\n';
    let firstResult: Map<string, string> | undefined;
    let secondResult: Map<string, string> | undefined;
    const spawnLabels = collectSandboxSpawnLabels(() => {
        firstResult = executeScriptAgainstState(script, preState);
        secondResult = executeScriptAgainstState(script, preState);
    });
    // one spawn, the same result object back, and the transform is correct.
    assert.equal(spawnLabels.length, 1);
    assert.equal(secondResult, firstResult);
    assert.equal(firstResult?.get("data.txt"), "after\n");
});

test("test_executeScriptAgainstState_distinguishes_seeded_content", () => {
    // Scenario: same script, different seeded CONTENT; the memo keys on content, never path names.
    const script = 'data = open("data.txt").read()\nopen("data.txt", "w").write(data + "x\\n")\n';
    const firstResult = executeScriptAgainstState(script, new Map([["data.txt", "a\n"]]));
    const secondResult = executeScriptAgainstState(script, new Map([["data.txt", "b\n"]]));
    // each seed got its own execution and its own correct output.
    assert.equal(firstResult?.get("data.txt"), "a\nx\n");
    assert.equal(secondResult?.get("data.txt"), "b\nx\n");
});

test("test_executeScriptAgainstState_memoizes_failed_runs", () => {
    // Scenario: a failing script memoizes too; repeats must not re-pay the spawn or timeout.
    const preState = new Map([["data.txt", "x\n"]]);
    const script = "raise SystemExit(1)\n";
    let firstResult: Map<string, string> | undefined;
    let secondResult: Map<string, string> | undefined;
    const spawnLabels = collectSandboxSpawnLabels(() => {
        firstResult = executeScriptAgainstState(script, preState);
        secondResult = executeScriptAgainstState(script, preState);
    });
    // one spawn; both calls report the failure as undefined.
    assert.equal(spawnLabels.length, 1);
    assert.equal(firstResult, undefined);
    assert.equal(secondResult, undefined);
});

function readStoredOutcome(script: string) {
    return getMemoizedSandboxOutcome(computeSandboxInputKey(script, new Map()));
}

test("test_executeScriptAgainstState_cannot_write_a_full_host_path_outside_the_mount", () => {
    const hostDir = mkdtempSync(join(tmpdir(), "reveng-host-"));
    const canary = join(hostDir, "canary.txt");
    writeFileSync(canary, "safe\n");
    try {
        const script = `open("${canary}", "w").write("pwned")\n`;
        assert.equal(executeScriptAgainstState(script, new Map(), "", new Path("/work")), undefined);
        assert.equal(readFileSync(canary, "utf8"), "safe\n");
    } finally {
        rmSync(hostDir, { recursive: true, force: true });
    }
});

test("test_executeScriptAgainstState_throws_DockerUnavailableError_when_docker_is_missing_and_stores_nothing", () => {
    const script = 'print("no docker program")\n';
    const savedPath = process.env.PATH;
    process.env.PATH = "";
    try {
        assert.throws(() => executeScriptAgainstState(script, new Map()), DockerUnavailableError);
    } finally {
        process.env.PATH = savedPath;
    }
    assert.equal(readStoredOutcome(script), undefined);
});

test("test_executeScriptAgainstState_reads_exit_125_as_docker_off_and_stores_nothing", () => {
    const script = "import sys\nsys.exit(125)\n";
    assert.throws(() => executeScriptAgainstState(script, new Map()), DockerUnavailableError);
    assert.equal(readStoredOutcome(script), undefined);
});

test("test_computeSandboxInputKey_adds_the_runtime_line_after_the_script", () => {
    const script = "pass\n";
    const preState = new Map([["b.txt", "2"], ["a.txt", "1"]]);
    const cwd = new Path("/Users/me/proj");
    const oldKeyParts = ["\0cwd\0" + cwd, "\0a.txt\x001", "\0b.txt\x002"];
    const oldKey = oldKeyParts.reduce((hash, part) => hash.update(part), createHash("sha256").update(script)).digest("hex");
    const newKey = createHash("sha256").update(script).update("\0runtime\0" + SANDBOX_IMAGE);
    const expectedKey = oldKeyParts.reduce((hash, part) => hash.update(part), newKey).digest("hex");
    assert.equal(computeSandboxInputKey(script, preState, cwd), expectedKey);
    assert.notEqual(computeSandboxInputKey(script, preState, cwd), oldKey);
});

test("test_computeSandboxInputKey_adds_the_box_text_only_when_a_box_exists", () => {
    // Scenario: no box keeps the old key; a box changes it; two different boxes give two keys.
    const script = "pass\n";
    const preState = new Map([["a.txt", "1"]]);
    const cwd = new Path("/Users/me/proj");
    const box = { root: cwd, workdir: cwd, scriptPath: new Path("/Users/me/proj/__script__.py"), stdoutRedirect: undefined, project: undefined };
    const otherBox = { ...box, scriptPath: new Path("/Users/me/proj/other.py") };
    assert.equal(computeSandboxInputKey(script, preState, cwd, undefined), computeSandboxInputKey(script, preState, cwd));
    assert.notEqual(computeSandboxInputKey(script, preState, cwd, box), computeSandboxInputKey(script, preState, cwd));
    assert.notEqual(computeSandboxInputKey(script, preState, cwd, box), computeSandboxInputKey(script, preState, cwd, otherBox));
});

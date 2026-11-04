// Real Docker, tiny scripts. They start only after the proof gate (part DK) is green.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSandboxStreaming, type OutputSink, type OutputStream } from "../src/reconstruction_script_sandbox_stream.ts";
import { computeSandboxInputKey } from "../src/reconstruction_script_sandbox.ts";
import { getMemoizedSandboxOutcome } from "../src/reconstruction_script_sandbox_memo.ts";
import { DockerStuckError, DockerUnavailableError } from "../src/reconstruction_script_sandbox_docker.ts";

const REAL_DOCKER = spawnSync("which", ["docker"], { encoding: "utf8" }).stdout.trim();
const PASS_THROUGH = `exec "${REAL_DOCKER}" "$@"`;
const IGNORE_OUTPUT: OutputSink = () => {};
const TEST_OPTIONS = { timeout: 90000 };

// A docker program on PATH that records its arguments, then runs `body` (default: the real docker).
async function withRecordingDocker<T>(body: string, run: (readRunCall: () => string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), "stream-docker-"));
    const savedPath = process.env.PATH;
    writeFileSync(join(dir, "docker"), `#!/bin/sh\necho "$@" >> "${dir}/calls"\n${body}\n`, { mode: 0o755 });
    process.env.PATH = `${dir}:${savedPath}`;
    try {
        return await run(() => readFileSync(join(dir, "calls"), "utf8").split("\n")[0]!);
    }
    finally {
        process.env.PATH = savedPath;
        rmSync(dir, { recursive: true, force: true });
    }
}

function readRunName(runCall: string): string {
    return /--name (\S+)/.exec(runCall)![1]!;
}

function readTempDir(runCall: string): string {
    return /-v (\S+?):/.exec(runCall)![1]!;
}

function listContainersNamed(name: string): string {
    return spawnSync(REAL_DOCKER, ["ps", "-q", "--filter", `name=${name}`], { encoding: "utf8" }).stdout.trim();
}

test("test_executeSandboxStreaming_prints_in_order_returns_files_and_removes_the_temp_dir", TEST_OPTIONS, async () => {
    const chunks: [OutputStream, string][] = [];
    const script = 'print("one", flush=True)\nprint("two")\nopen("out.txt", "w").write(open("seed.txt").read() + "z")\n';
    await withRecordingDocker(PASS_THROUGH, async (readRunCall) => {
        const result = await executeSandboxStreaming(script, new Map([["seed.txt", "s"]]), undefined, (stream, text) => chunks.push([stream, text]), new AbortController().signal);
        assert.equal(result.output.stdout, "one\ntwo\n");
        assert.equal(chunks.map(([, text]) => text).join(""), "one\ntwo\n");
        assert.equal(chunks[0]![0], "stdout");
        assert.equal(result.output.exitCode, 0);
        assert.equal(result.output.timedOut, false);
        assert.equal(result.isCancelled, false);
        assert.deepEqual([...result.post!].sort(), [["out.txt", "sz"], ["seed.txt", "s"]]);
        assert.equal(existsSync(readTempDir(readRunCall())), false);
    });
});

test("test_executeSandboxStreaming_keeps_stderr_separate", TEST_OPTIONS, async () => {
    const chunks: [OutputStream, string][] = [];
    const script = 'import sys\nprint("out")\nprint("err", file=sys.stderr)\n';
    const result = await executeSandboxStreaming(script, new Map(), undefined, (stream, text) => chunks.push([stream, text]), new AbortController().signal);
    assert.equal(result.output.stdout, "out\n");
    assert.equal(result.output.stderr, "err\n");
    assert.deepEqual(chunks.filter(([stream]) => stream === "stderr").map(([, text]) => text), ["err\n"]);
});

test("test_executeSandboxStreaming_reports_the_exit_code_and_returns_no_files", TEST_OPTIONS, async () => {
    const result = await executeSandboxStreaming("import sys\nsys.exit(1)\n", new Map(), undefined, IGNORE_OUTPUT, new AbortController().signal);
    assert.equal(result.output.exitCode, 1);
    assert.equal(result.output.timedOut, false);
    assert.equal(result.post, undefined);
});

test("test_executeSandboxStreaming_times_out_and_leaves_no_container", TEST_OPTIONS, async () => {
    await withRecordingDocker(PASS_THROUGH, async (readRunCall) => {
        const startedAt = Date.now();
        const result = await executeSandboxStreaming("import time\ntime.sleep(30)\n", new Map(), undefined, IGNORE_OUTPUT, new AbortController().signal, 1500);
        assert.equal(result.output.timedOut, true);
        assert.equal(result.post, undefined);
        assert.ok(Date.now() - startedAt < 20000);
        assert.equal(listContainersNamed(readRunName(readRunCall())), "");
    });
});

test("test_executeSandboxStreaming_abort_kills_the_container_and_reports_cancelled", TEST_OPTIONS, async () => {
    const controller = new AbortController();
    await withRecordingDocker(PASS_THROUGH, async (readRunCall) => {
        const startedAt = Date.now();
        const abortOnReady: OutputSink = () => controller.abort();
        const result = await executeSandboxStreaming('print("ready", flush=True)\nimport time\ntime.sleep(30)\n', new Map(), undefined, abortOnReady, controller.signal, 25000);
        assert.equal(result.isCancelled, true);
        assert.equal(result.post, undefined);
        assert.ok(Date.now() - startedAt < 20000);
        assert.equal(listContainersNamed(readRunName(readRunCall())), "");
    });
});

test("test_executeSandboxStreaming_throws_DockerUnavailableError_when_docker_is_off", TEST_OPTIONS, async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = "";
    try {
        await assert.rejects(() => executeSandboxStreaming("pass\n", new Map(), undefined, IGNORE_OUTPUT, new AbortController().signal), DockerUnavailableError);
    }
    finally {
        process.env.PATH = savedPath;
    }
});

test("test_executeSandboxStreaming_throws_DockerUnavailableError_on_exit_125_and_removes_the_temp_dir", TEST_OPTIONS, async () => {
    await withRecordingDocker("exit 125", async (readRunCall) => {
        await assert.rejects(() => executeSandboxStreaming("pass\n", new Map(), undefined, IGNORE_OUTPUT, new AbortController().signal), DockerUnavailableError);
        assert.equal(existsSync(readTempDir(readRunCall())), false);
    });
});

test("test_executeSandboxStreaming_throws_DockerStuckError_saves_nothing_and_removes_the_temp_dir", TEST_OPTIONS, async () => {
    const script = 'print("stuck")\n';
    const fakeStuckDocker = 'case "$1" in run) exec sleep 3;; inspect) echo created;; esac';
    await withRecordingDocker(fakeStuckDocker, async (readRunCall) => {
        await assert.rejects(() => executeSandboxStreaming(script, new Map(), undefined, IGNORE_OUTPUT, new AbortController().signal, 300), DockerStuckError);
        assert.equal(existsSync(readTempDir(readRunCall())), false);
    });
    assert.equal(getMemoizedSandboxOutcome(computeSandboxInputKey(script, new Map())), undefined);
});

// Tests of the exit rule of the terminal viewer: no child process outlives the viewer, and the lock goes away.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import { shutdownTui } from "../engineV3/tui/engineV3_tui_shutdown.ts";
import { acquireTuiLock, getTuiLockFile } from "../engineV3/tui/engineV3_tui_settings.ts";
import { listLiveChildProcessIds, runStepChild } from "../engineV3/tui/engineV3_tui_step_process.ts";
import type { SpawnStepProcess, StepPool, StepPoolOptions, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { Path } from "../src/structures/domain.ts";
import { PlayOutcomeKind, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";

const POLL_INTERVAL_MILLISECONDS = 20;
const WAIT_TIMEOUT_MILLISECONDS = 10000;
const NEGATIVE_WAIT_MILLISECONDS = 60;
const SLEEPER_ARGUMENTS = ["-e", "setInterval(()=>{},1000)"];
const JFRED_FOLDER = join(import.meta.dirname, "..");

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForCondition(check: () => boolean, timeoutMilliseconds: number): Promise<void> {
    const startedAtMilliseconds = Date.now();
    while (!check()) {
        if (Date.now() - startedAtMilliseconds > timeoutMilliseconds) {
            throw new Error(`waitForCondition timed out after ${timeoutMilliseconds} ms`);
        }
        await waitMilliseconds(POLL_INTERVAL_MILLISECONDS);
    }
}

function isProcessAlive(processId: number): boolean {
    return spawnSync("ps", ["-p", String(processId)]).status === 0;
}

function killProcessGroupIfAlive(processId: number): void {
    if (isProcessAlive(processId)) {
        process.kill(-processId, "SIGKILL");
    }
}

function makeCrashedOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Crashed, exitCode: 1, signal: null, crashedAt: null, stderrTail: "" };
}

function makeStepRequest(): StepRequest {
    return { file: new Path("/project/a.ts"), startAt: new Date(1000), isPassingStops: false };
}

function makePoolWithSpawn(spawnStepProcess: SpawnStepProcess): StepPool {
    const options: StepPoolOptions = {
        maxProcesses: 4,
        spawnStepProcess,
        spawnPlayProcess: async () => ({ kind: PlayOutcomeKind.Replayed, reasonText: undefined }),
        onOutcome: () => {},
        onStatusChange: () => {},
        isFileWalkFinished: () => false,
        isFileSteppable: () => true,
        hasLogsGrown: () => false,
        onLogsGrew: () => {},
        endChildOfFile: async () => {},
        endAllChildren: async () => {},
    };
    return createStepPool(options);
}

function makeStoreFolderForLock(): { storeFolder: Path; removeLockAndStore: () => void } {
    const parentFolder = mkdtempSync(join(tmpdir(), "jfred-tui-shutdown-"));
    const storeFolder = join(parentFolder, "store");
    mkdirSync(storeFolder, { recursive: true });
    function removeLockAndStore(): void {
        rmSync(join(JFRED_FOLDER, ".cache", "tui", basename(storeFolder)), { recursive: true, force: true });
        rmSync(parentFolder, { recursive: true, force: true });
    }
    return { storeFolder: new Path(storeFolder), removeLockAndStore };
}

test("test_shutdownTui_stops_the_pool_ends_every_live_child_and_waits_for_their_exit", async (t) => {
    // Scenario: shutdownTui ends every live child process group and returns only after the children have exited.
    const { storeFolder, removeLockAndStore } = makeStoreFolderForLock();
    t.after(removeLockAndStore);
    // two real sleeper children start through the real spawn function; the test does not wait for them
    const workingFolder = new Path(tmpdir());
    const outcomePromises = [runStepChild(process.execPath, SLEEPER_ARGUMENTS, workingFolder), runStepChild(process.execPath, SLEEPER_ARGUMENTS, workingFolder)];
    // the test waits until the registry lists both children
    await waitForCondition(() => listLiveChildProcessIds().length === 2, WAIT_TIMEOUT_MILLISECONDS);
    const childProcessIds = listLiveChildProcessIds();
    t.after(() => childProcessIds.forEach(killProcessGroupIfAlive));
    for (const childProcessId of childProcessIds) {
        assert.equal(isProcessAlive(childProcessId), true);
    }
    // the shutdown runs over a real pool built from fake options
    const pool = makePoolWithSpawn(async () => makeCrashedOutcome());
    await shutdownTui(pool, storeFolder);
    // every child process is gone as soon as the shutdown returns
    for (const childProcessId of childProcessIds) {
        assert.equal(isProcessAlive(childProcessId), false);
    }
    // the child promises resolve (the sleepers were killed, so a loud failure shows here)
    await Promise.all(outcomePromises);
    assert.deepEqual(listLiveChildProcessIds(), []);
});

test("test_a_stopped_pool_starts_no_new_child", async () => {
    // Scenario: after pool.stopStarting(), a walk request spawns nothing.
    const spawnedRequests: StepRequest[] = [];
    const pool = makePoolWithSpawn(async (request) => {
        spawnedRequests.push(request);
        return makeCrashedOutcome();
    });
    // the pool stops starting children
    pool.stopStarting();
    // a request arrives afterwards
    pool.requestWalk(makeStepRequest(), true);
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    // the spawn function was never called
    assert.equal(spawnedRequests.length, 0);
});

test("test_no_child_is_alive_after_the_process_exits_by_a_crash", async (t) => {
    // Scenario: a process that starts two sleeper children and then throws leaves no child alive.
    const stepProcessUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_step_process.ts")).href;
    const domainUrl = pathToFileURL(join(JFRED_FOLDER, "src/structures/domain.ts")).href;
    const crashingScript = [
        `import { runStepChild, listLiveChildProcessIds } from ${JSON.stringify(stepProcessUrl)};`,
        `import { Path } from ${JSON.stringify(domainUrl)};`,
        `const workingFolder = new Path(process.cwd());`,
        `runStepChild(process.execPath, ${JSON.stringify(SLEEPER_ARGUMENTS)}, workingFolder);`,
        `runStepChild(process.execPath, ${JSON.stringify(SLEEPER_ARGUMENTS)}, workingFolder);`,
        `console.log(JSON.stringify(listLiveChildProcessIds()));`,
        `throw new Error("crash on purpose");`,
    ].join("\n");
    // a second process starts the children, prints their process ids, and crashes
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", crashingScript], { cwd: JFRED_FOLDER, encoding: "utf8" });
    const printedLine = result.stdout.split("\n").find((line) => line.startsWith("["));
    assert.notEqual(printedLine, undefined, `no process id line in stdout: ${result.stdout} / stderr: ${result.stderr}`);
    const childProcessIds: number[] = JSON.parse(printedLine!);
    t.after(() => childProcessIds.forEach(killProcessGroupIfAlive));
    // the crash happened, and two children had been alive
    assert.notEqual(result.status, 0);
    assert.equal(childProcessIds.length, 2);
    // after the crashed process is gone, no child is alive
    await waitForCondition(() => childProcessIds.every((childProcessId) => !isProcessAlive(childProcessId)), WAIT_TIMEOUT_MILLISECONDS);
    for (const childProcessId of childProcessIds) {
        assert.equal(isProcessAlive(childProcessId), false);
    }
});

test("test_the_lock_is_removed_by_the_shutdown", async (t) => {
    // Scenario: the shutdown removes the lock file of the store.
    const { storeFolder, removeLockAndStore } = makeStoreFolderForLock();
    t.after(removeLockAndStore);
    // the viewer takes the lock, so the lock file exists
    acquireTuiLock(storeFolder);
    assert.equal(existsSync(getTuiLockFile(storeFolder).toString()), true);
    // the shutdown runs over a real pool built from fake options
    await shutdownTui(makePoolWithSpawn(async () => makeCrashedOutcome()), storeFolder);
    // the lock file is gone
    assert.equal(existsSync(getTuiLockFile(storeFolder).toString()), false);
});

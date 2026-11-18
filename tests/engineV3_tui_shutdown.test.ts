// Tests of the exit rule of the terminal viewer: no child process outlives the viewer, and the lock goes away.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import { shutdownTui } from "../engineV3/tui/engineV3_tui_shutdown.ts";
import { acquireTuiLock, getTuiLockFile } from "../engineV3/tui/engineV3_tui_settings.ts";
import { endAllLiveChildren, listLiveChildProcessIds, runStepChild } from "../engineV3/tui/engineV3_tui_step_process.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import { createWalkState, getFileRunState, setFileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { SpawnStepProcess, StepPool, StepPoolOptions, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, PlayOutcomeKind, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";

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
        // endAllChildren: async () => {},
        endAllChildren: endAllLiveChildren,
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

test("test_the_lock_file_is_gone_after_the_process_ends_by_a_thrown_error", (t) => {
    // Scenario: a process that takes the lock, starts no child, and then throws leaves no lock file.
    const { storeFolder, removeLockAndStore } = makeStoreFolderForLock();
    t.after(removeLockAndStore);
    const settingsUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_settings.ts")).href;
    const domainUrl = pathToFileURL(join(JFRED_FOLDER, "src/structures/domain.ts")).href;
    const crashingScript = [
        `import { acquireTuiLock } from ${JSON.stringify(settingsUrl)};`,
        `import { Path } from ${JSON.stringify(domainUrl)};`,
        `acquireTuiLock(new Path(${JSON.stringify(storeFolder.toString())}));`,
        `throw new Error("crash on purpose");`,
    ].join("\n");
    // a second process takes the lock and crashes
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", crashingScript], { cwd: JFRED_FOLDER, encoding: "utf8" });
    // the crash happened
    assert.notEqual(result.status, 0);
    // the lock file is gone
    assert.equal(existsSync(getTuiLockFile(storeFolder).toString()), false, `stderr: ${result.stderr}`);
});

test("test_the_lock_file_stays_when_it_holds_another_process_number", (t) => {
    // Scenario: a crashing process does not remove a lock file that holds the process number of another process.
    const { storeFolder, removeLockAndStore } = makeStoreFolderForLock();
    t.after(removeLockAndStore);
    const settingsUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_settings.ts")).href;
    const domainUrl = pathToFileURL(join(JFRED_FOLDER, "src/structures/domain.ts")).href;
    const lockFilePath = getTuiLockFile(storeFolder).toString();
    const crashingScript = [
        `import { writeFileSync } from "node:fs";`,
        `import { acquireTuiLock, getTuiLockFile } from ${JSON.stringify(settingsUrl)};`,
        `import { Path } from ${JSON.stringify(domainUrl)};`,
        `const storeFolder = new Path(${JSON.stringify(storeFolder.toString())});`,
        `acquireTuiLock(storeFolder);`,
        `writeFileSync(getTuiLockFile(storeFolder).toString(), "1");`,
        `throw new Error("crash on purpose");`,
    ].join("\n");
    // a second process takes the lock, overwrites it with the process number 1, and crashes
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", crashingScript], { cwd: JFRED_FOLDER, encoding: "utf8" });
    // the crash happened
    assert.notEqual(result.status, 0);
    // the lock file still exists and still holds 1
    assert.equal(existsSync(lockFilePath), true, `stderr: ${result.stderr}`);
    assert.equal(readFileSync(lockFilePath, "utf8"), "1");
});

function buildSignalProbeScript(storeFolder: Path): string {
    const poolUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_pool.ts")).href;
    const settingsUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_settings.ts")).href;
    const shutdownUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_shutdown.ts")).href;
    const stepProcessUrl = pathToFileURL(join(JFRED_FOLDER, "engineV3/tui/engineV3_tui_step_process.ts")).href;
    const domainUrl = pathToFileURL(join(JFRED_FOLDER, "src/structures/domain.ts")).href;
    return [
        `import { acquireTuiLock } from ${JSON.stringify(settingsUrl)};`,
        `import { runStepChild, listLiveChildProcessIds } from ${JSON.stringify(stepProcessUrl)};`,
        `import { createStepPool } from ${JSON.stringify(poolUrl)};`,
        `import { registerShutdownSignalHandlers } from ${JSON.stringify(shutdownUrl)};`,
        `import { Path } from ${JSON.stringify(domainUrl)};`,
        `const throwIfCalled = async () => { throw new Error("the pool must not spawn in this script"); };`,
        `const pool = createStepPool({`,
        `    maxProcesses: 4,`,
        `    spawnStepProcess: throwIfCalled,`,
        `    spawnPlayProcess: throwIfCalled,`,
        `    onOutcome: () => {},`,
        `    onStatusChange: () => {},`,
        `    isFileWalkFinished: () => false,`,
        `    isFileSteppable: () => true,`,
        `    hasLogsGrown: () => false,`,
        `    onLogsGrew: () => {},`,
        `    endChildOfFile: async () => {},`,
        `    endAllChildren: async () => {},`,
        `});`,
        `const storeFolder = new Path(${JSON.stringify(storeFolder.toString())});`,
        `acquireTuiLock(storeFolder);`,
        `const workingFolder = new Path(process.cwd());`,
        `runStepChild(process.execPath, ${JSON.stringify(SLEEPER_ARGUMENTS)}, workingFolder);`,
        `runStepChild(process.execPath, ${JSON.stringify(SLEEPER_ARGUMENTS)}, workingFolder);`,
        `registerShutdownSignalHandlers(pool, storeFolder);`,
        `console.log(JSON.stringify(listLiveChildProcessIds()));`,
        `setInterval(() => {}, 1000);`,
    ].join("\n");
}

function readChildProcessIdsPrintedBy(scriptProcess: ChildProcess): Promise<number[]> {
    return new Promise((resolve, reject) => {
        let printedText = "";
        const timer = setTimeout(() => reject(new Error(`no process id line within ${WAIT_TIMEOUT_MILLISECONDS} ms: ${printedText}`)), WAIT_TIMEOUT_MILLISECONDS);
        scriptProcess.stdout!.on("data", (chunk) => {
            printedText += chunk.toString();
            const printedLine = printedText.split("\n").find((line) => line.startsWith("["));
            if (printedLine !== undefined) {
                clearTimeout(timer);
                resolve(JSON.parse(printedLine));
            }
        });
    });
}

function waitForExitCode(scriptProcess: ChildProcess): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`the script did not exit within ${WAIT_TIMEOUT_MILLISECONDS} ms`)), WAIT_TIMEOUT_MILLISECONDS);
        scriptProcess.once("exit", (exitCode) => {
            clearTimeout(timer);
            resolve(exitCode);
        });
    });
}

async function verifySignalRunsTheShutdown(t: TestContext, signal: NodeJS.Signals): Promise<void> {
    const { storeFolder, removeLockAndStore } = makeStoreFolderForLock();
    t.after(removeLockAndStore);
    // a second process takes the lock, starts two sleeper children, registers the signal handlers, and prints the child process ids
    const scriptProcess = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", buildSignalProbeScript(storeFolder)], { cwd: JFRED_FOLDER, stdio: ["ignore", "pipe", "pipe"] });
    t.after(() => scriptProcess.kill("SIGKILL"));
    const childProcessIdsPromise = readChildProcessIdsPrintedBy(scriptProcess);
    const childProcessIds = await childProcessIdsPromise;
    t.after(() => childProcessIds.forEach(killProcessGroupIfAlive));
    // two children are alive and the lock file exists before the signal
    assert.equal(childProcessIds.length, 2);
    for (const childProcessId of childProcessIds) {
        assert.equal(isProcessAlive(childProcessId), true);
    }
    assert.equal(existsSync(getTuiLockFile(storeFolder).toString()), true);
    // the signal reaches the second process, and the test waits for that process to exit
    const exitCodePromise = waitForExitCode(scriptProcess);
    scriptProcess.kill(signal);
    const exitCode = await exitCodePromise;
    // the process ends with exit code 0
    assert.equal(exitCode, 0);
    // every child process is gone
    await waitForCondition(() => childProcessIds.every((childProcessId) => !isProcessAlive(childProcessId)), WAIT_TIMEOUT_MILLISECONDS);
    for (const childProcessId of childProcessIds) {
        assert.equal(isProcessAlive(childProcessId), false);
    }
    // the lock file is gone
    assert.equal(existsSync(getTuiLockFile(storeFolder).toString()), false);
}

test("test_a_sigterm_runs_the_shutdown_ends_every_child_and_removes_the_lock", async (t) => {
    // Scenario: a SIGTERM sent to a viewer process runs the same shutdown as Ctrl-C, then the process exits with code 0.
    await verifySignalRunsTheShutdown(t, "SIGTERM");
});

test("test_a_sighup_runs_the_shutdown_ends_every_child_and_removes_the_lock", async (t) => {
    // Scenario: a SIGHUP sent to a viewer process runs the same shutdown as Ctrl-C, then the process exits with code 0.
    await verifySignalRunsTheShutdown(t, "SIGHUP");
});

test("test_a_step_child_ended_by_the_shutdown_gives_no_crashed_status_and_no_error_text", async (t) => {
    // Scenario: the answer of a step child that the shutdown itself ended is dropped: no Crashed status, no error text.
    const { storeFolder, removeLockAndStore } = makeStoreFolderForLock();
    t.after(removeLockAndStore);
    const file = new Path("/project/a.ts");
    const walkState = createWalkState();
    // a walker writes every status it gives into a real walk state
    const walker = createHistoryWalker({
        storeFolder,
        projectFolder: new Path("/project"),
        walkState,
        requestWalk: () => {},
        requestPlay: async () => ({ kind: PlayOutcomeKind.Replayed, reasonText: undefined }),
        decideScriptAction: () => {
            throw new Error("the walker must not decide a script action in this test");
        },
        onStatusChange: (changedFile, runState) => setFileRunState(walkState, changedFile, runState),
    });
    // the fake step child answers only when the test resolves it by hand
    let resolveFakeChild: (outcome: StepProcessOutcome) => void = () => {};
    const fakeChildOutcomePromise = new Promise<StepProcessOutcome>((resolve) => {
        resolveFakeChild = resolve;
    });
    let endAllChildrenCallCount = 0;
    // a real pool sends every child answer to the walker
    const pool = createStepPool({
        maxProcesses: 4,
        spawnStepProcess: () => fakeChildOutcomePromise,
        spawnPlayProcess: async () => ({ kind: PlayOutcomeKind.Replayed, reasonText: undefined }),
        onOutcome: (request, outcome) => {
            void walker.handleOutcome(request, outcome);
        },
        onStatusChange: (changedFile, runState) => setFileRunState(walkState, changedFile, runState),
        isFileWalkFinished: () => false,
        isFileSteppable: () => true,
        hasLogsGrown: () => false,
        onLogsGrew: () => {},
        endChildOfFile: async () => {},
        endAllChildren: async () => {
            endAllChildrenCallCount += 1;
        },
    });
    // one file is requested, so the fake child is running
    pool.requestWalk({ file, startAt: new Date(1000), isPassingStops: false }, true);
    assert.deepEqual(pool.listRunningFiles(), [file]);
    // the shutdown runs while the child is running
    await shutdownTui(pool, storeFolder);
    // the shutdown asked the pool to end all children once
    assert.equal(endAllChildrenCallCount, 1);
    // the kill result of the child arrives after the shutdown returned
    resolveFakeChild({ kind: StepProcessOutcomeKind.Crashed, exitCode: null, signal: "SIGTERM", crashedAt: null, stderrTail: "" });
    await waitMilliseconds(0);
    // the file has no Crashed status and no error text
    const runState = getFileRunState(walkState, file);
    assert.notEqual(runState.status, FileWalkStatus.Crashed);
    assert.equal(runState.reasonText, undefined);
});

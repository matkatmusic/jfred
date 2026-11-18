// Tests of the step pool of the terminal viewer: size limit, one child per file, queue order, and the play request.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import type { FileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { PlayOutcome, PlayRequest, SpawnPlayProcess, SpawnStepProcess, StepPool, StepPoolOptions, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import type { StepResultLine } from "../engineV3/engineV3_step_start_at.ts";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, InverseStepOutcome, PlayOutcomeKind, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";

const POLL_INTERVAL_MILLISECONDS = 5;
const WAIT_TIMEOUT_MILLISECONDS = 2000;
const NEGATIVE_WAIT_MILLISECONDS = 40;

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

function makeFile(name: string): Path {
    return new Path(`/project/${name}`);
}

function makeWalkRequest(file: Path, startAtSeconds: number, isPassingStops: boolean = false): StepRequest {
    return { file, startAt: new Date(startAtSeconds * 1000), isPassingStops };
}

function makeResultLine(outcome: InverseStepOutcome): StepResultLine {
    return { startAt: new Date(0).toISOString(), outcome, commitsWritten: 0, position: 0, commit: "0000000", eventType: null, source: null };
}

function makeCoveredOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Covered, lastLine: makeResultLine(InverseStepOutcome.StartAtReached) };
}

function makeFinishedOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Finished, lastLine: makeResultLine(InverseStepOutcome.NoOlderChange) };
}

function makeCrashedOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Crashed, exitCode: 1, signal: null, crashedAt: null, stderrTail: "" };
}

// A gate is a promise that opens once; a closed gate holds whoever waits on it.
type Gate = { wait: () => Promise<void>; open: () => void };

function makeGate(isOpenAtStart: boolean): Gate {
    let openGate!: () => void;
    const promise = new Promise<void>((resolve) => {
        openGate = resolve;
    });
    if (isOpenAtStart) {
        openGate();
    }
    return { wait: () => promise, open: openGate };
}

type HeldCall = { request: StepRequest; resolveOutcome: (outcome: StepProcessOutcome) => void; isOpen: boolean };

// A fake SpawnStepProcess: every call stays open until the test resolves it.
function makeHeldSpawn(eventLog: string[]) {
    const calls: HeldCall[] = [];
    const openCountByFileValue = new Map<string, number>();
    const peakOpenCountByFileValue = new Map<string, number>();
    let openCount = 0;
    let peakOpenCount = 0;

    const spawnStepProcess: SpawnStepProcess = (request) => {
        return new Promise<StepProcessOutcome>((resolve) => {
            eventLog.push(`walk:${request.file.value}`);
            calls.push({ request, resolveOutcome: resolve, isOpen: true });
            openCount += 1;
            peakOpenCount = Math.max(peakOpenCount, openCount);
            const openCountOfFile = (openCountByFileValue.get(request.file.value) ?? 0) + 1;
            openCountByFileValue.set(request.file.value, openCountOfFile);
            peakOpenCountByFileValue.set(request.file.value, Math.max(peakOpenCountByFileValue.get(request.file.value) ?? 0, openCountOfFile));
        });
    };

    function closeCall(call: HeldCall, outcome: StepProcessOutcome): void {
        call.isOpen = false;
        openCount -= 1;
        openCountByFileValue.set(call.request.file.value, openCountByFileValue.get(call.request.file.value)! - 1);
        call.resolveOutcome(outcome);
    }

    function findOpenCallOfFile(file: Path): HeldCall | undefined {
        return calls.find((call) => call.isOpen && call.request.file.equals(file));
    }

    return {
        spawnStepProcess,
        getRequests: (): StepRequest[] => calls.map((call) => call.request),
        countOpenCalls: (): number => openCount,
        getPeakConcurrentCalls: (): number => peakOpenCount,
        getPeakConcurrentCallsOfFile: (file: Path): number => peakOpenCountByFileValue.get(file.value) ?? 0,
        hasOpenCallForFile: (file: Path): boolean => findOpenCallOfFile(file) !== undefined,
        resolveCallNumber: (callNumber: number, outcome: StepProcessOutcome): void => closeCall(calls[callNumber]!, outcome),
        resolveOpenCallOfFile: (file: Path, outcome: StepProcessOutcome): void => {
            const call = findOpenCallOfFile(file);
            if (call !== undefined) {
                closeCall(call, outcome);
            }
        },
        resolveEveryOpenCall: (outcome: StepProcessOutcome): void => {
            for (const call of calls) {
                if (call.isOpen) {
                    closeCall(call, outcome);
                }
            }
        },
    };
}

type HarnessSettings = { maxProcesses?: number; isPlayHeld?: boolean; isExitHeld?: boolean; unsteppableFiles?: Path[] };

function makeHarness(settings: HarnessSettings) {
    const eventLog: string[] = [];
    const held = makeHeldSpawn(eventLog);
    const outcomeCalls: { request: StepRequest; outcome: StepProcessOutcome }[] = [];
    const statusLog: { file: Path; status: FileWalkStatus }[] = [];
    const finishedFileValues = new Set<string>();
    const unsteppableFileValues = new Set((settings.unsteppableFiles ?? []).map((file) => file.value));
    const playGate = makeGate(!settings.isPlayHeld);
    const exitGate = makeGate(!settings.isExitHeld);
    const playedFiles: Path[] = [];

    const spawnPlayProcess: SpawnPlayProcess = async (request: PlayRequest): Promise<PlayOutcome> => {
        eventLog.push(`play:${request.file.value}`);
        playedFiles.push(request.file);
        await playGate.wait();
        return { kind: PlayOutcomeKind.Replayed, reasonText: undefined };
    };

    const options: StepPoolOptions = {
        maxProcesses: settings.maxProcesses ?? 4,
        spawnStepProcess: held.spawnStepProcess,
        spawnPlayProcess,
        onOutcome: (request, outcome) => {
            outcomeCalls.push({ request, outcome });
        },
        onStatusChange: (file: Path, runState: FileRunState) => {
            statusLog.push({ file, status: runState.status });
        },
        isFileWalkFinished: (file) => finishedFileValues.has(file.value),
        isFileSteppable: (file) => !unsteppableFileValues.has(file.value),
        hasLogsGrown: () => false,
        onLogsGrew: () => {},
        endChildOfFile: async (file) => {
            await exitGate.wait();
            held.resolveOpenCallOfFile(file, makeCrashedOutcome());
        },
        endAllChildren: async () => {
            await exitGate.wait();
            held.resolveEveryOpenCall(makeCrashedOutcome());
        },
    };

    return {
        options,
        held,
        eventLog,
        outcomeCalls,
        statusLog,
        finishedFileValues,
        playedFiles,
        releasePlay: playGate.open,
        releaseChildExits: exitGate.open,
    };
}

function makeTestPool(settings: HarnessSettings) {
    const harness = makeHarness(settings);
    const pool: StepPool = createStepPool(harness.options);
    return { ...harness, pool };
}

type TestPool = ReturnType<typeof makeTestPool>;

function listStatusesOfFile(testPool: TestPool, file: Path): FileWalkStatus[] {
    return testPool.statusLog.filter((entry) => entry.file.equals(file)).map((entry) => entry.status);
}

async function finishWalkToEnd(testPool: TestPool, file: Path): Promise<void> {
    await waitForCondition(() => testPool.held.hasOpenCallForFile(file), WAIT_TIMEOUT_MILLISECONDS);
    testPool.finishedFileValues.add(file.value);
    testPool.held.resolveOpenCallOfFile(file, makeFinishedOutcome());
}

test("test_pool_never_runs_more_than_the_limit_at_once", async () => {
    // Scenario: a pool of 2 gets 5 requests for 5 files while every child stays open.
    // Steps:
    // the pool is created with maxProcesses 2 and the fake processes stay open until the test resolves them.
    const testPool = makeTestPool({ maxProcesses: 2 });
    // five different files are requested.
    for (let fileNumber = 0; fileNumber < 5; fileNumber += 1) {
        testPool.pool.requestWalk(makeWalkRequest(makeFile(`file${fileNumber}.txt`), 10), true);
    }
    // exactly 2 children start, and no third one starts while the two are open.
    await waitForCondition(() => testPool.held.countOpenCalls() === 2, WAIT_TIMEOUT_MILLISECONDS);
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    assert.equal(testPool.held.getRequests().length, 2);
    // the test resolves the calls one by one in request order until all five have run.
    for (let callNumber = 0; callNumber < 5; callNumber += 1) {
        await waitForCondition(() => testPool.held.getRequests().length > callNumber, WAIT_TIMEOUT_MILLISECONDS);
        testPool.held.resolveCallNumber(callNumber, makeCoveredOutcome());
    }
    await testPool.pool.waitUntilIdle();
    // five children ran in total and never more than 2 at one time.
    assert.equal(testPool.held.getRequests().length, 5);
    assert.equal(testPool.held.getPeakConcurrentCalls(), 2);
});

test("test_processes_flag_above_four_throws", () => {
    // Scenario: createStepPool refuses a pool size above 4.
    // Steps:
    // build the options with maxProcesses 5.
    const harness = makeHarness({ maxProcesses: 5 });
    // creating the pool throws.
    assert.throws(() => createStepPool(harness.options));
});

test("test_pool_never_runs_two_processes_for_one_file", async () => {
    // Scenario: three requests for the same file arrive while its child runs.
    // Steps:
    // request the file at second 100, then at seconds 50 and 80.
    const testPool = makeTestPool({ maxProcesses: 4 });
    const file = makeFile("one.txt");
    testPool.pool.requestWalk(makeWalkRequest(file, 100), true);
    await waitForCondition(() => testPool.held.hasOpenCallForFile(file), WAIT_TIMEOUT_MILLISECONDS);
    testPool.pool.requestWalk(makeWalkRequest(file, 50), true);
    testPool.pool.requestWalk(makeWalkRequest(file, 80), true);
    // no second child starts while the first one is open.
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    assert.equal(testPool.held.getRequests().length, 1);
    // after the exit of the first child the pending request runs and the first child is gone.
    testPool.held.resolveCallNumber(0, makeCoveredOutcome());
    await waitForCondition(() => testPool.held.getRequests().length === 2, WAIT_TIMEOUT_MILLISECONDS);
    testPool.held.resolveCallNumber(1, makeCoveredOutcome());
    await testPool.pool.waitUntilIdle();
    // at no time were two children open for this file.
    assert.equal(testPool.held.getPeakConcurrentCallsOfFile(file), 1);
});

test("test_a_request_for_a_busy_file_runs_once_more_with_the_older_time_after_the_exit", async () => {
    // Scenario: requests for a busy file collapse to one more run with the oldest requested time.
    // Steps:
    // the file runs for the time of second 100.
    const testPool = makeTestPool({ maxProcesses: 4 });
    const file = makeFile("one.txt");
    testPool.pool.requestWalk(makeWalkRequest(file, 100), true);
    await waitForCondition(() => testPool.held.hasOpenCallForFile(file), WAIT_TIMEOUT_MILLISECONDS);
    // two requests arrive while it runs: second 50, then second 80.
    testPool.pool.requestWalk(makeWalkRequest(file, 50), true);
    testPool.pool.requestWalk(makeWalkRequest(file, 80), true);
    // the first child exits.
    testPool.held.resolveCallNumber(0, makeCoveredOutcome());
    // the handler is called for the captured time (second 100).
    await waitForCondition(() => testPool.outcomeCalls.length === 1, WAIT_TIMEOUT_MILLISECONDS);
    assert.equal(testPool.outcomeCalls[0]!.request.startAt.getTime(), 100_000);
    // the pool runs the file once more with the older pending time (second 50).
    await waitForCondition(() => testPool.held.getRequests().length === 2, WAIT_TIMEOUT_MILLISECONDS);
    assert.equal(testPool.held.getRequests()[1]!.startAt.getTime(), 50_000);
    // no third run follows.
    testPool.held.resolveCallNumber(1, makeCoveredOutcome());
    await testPool.pool.waitUntilIdle();
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    assert.equal(testPool.held.getRequests().length, 2);
});

test("test_visible_files_are_started_before_hidden_files", async () => {
    // Scenario: with one free slot, queued visible files start before queued hidden files.
    // Steps:
    // a pool of 1 runs a blocker file.
    const testPool = makeTestPool({ maxProcesses: 1 });
    const blockerFile = makeFile("blocker.txt");
    testPool.pool.requestWalk(makeWalkRequest(blockerFile, 10), true);
    await waitForCondition(() => testPool.held.hasOpenCallForFile(blockerFile), WAIT_TIMEOUT_MILLISECONDS);
    // two hidden files are requested first, then two visible files.
    testPool.pool.requestWalk(makeWalkRequest(makeFile("hiddenA.txt"), 10), false);
    testPool.pool.requestWalk(makeWalkRequest(makeFile("hiddenB.txt"), 10), false);
    testPool.pool.requestWalk(makeWalkRequest(makeFile("visibleC.txt"), 10), true);
    testPool.pool.requestWalk(makeWalkRequest(makeFile("visibleD.txt"), 10), true);
    // the test releases the slot one call at a time.
    for (let callNumber = 0; callNumber < 5; callNumber += 1) {
        await waitForCondition(() => testPool.held.getRequests().length > callNumber, WAIT_TIMEOUT_MILLISECONDS);
        testPool.held.resolveCallNumber(callNumber, makeCoveredOutcome());
    }
    await testPool.pool.waitUntilIdle();
    // the start order is: blocker, visible files in request order, then hidden files in request order.
    const startedFileValues = testPool.held.getRequests().map((request) => request.file.value);
    assert.deepEqual(startedFileValues, ["/project/blocker.txt", "/project/visibleC.txt", "/project/visibleD.txt", "/project/hiddenA.txt", "/project/hiddenB.txt"]);
});

test("test_before_a_play_every_replay_file_is_walked_to_the_end_through_the_pool", async () => {
    // Scenario: a play request walks the other replay files to the end first, then starts the play child.
    // Steps:
    // two other replay files are not finished.
    const testPool = makeTestPool({ maxProcesses: 4 });
    const playedFile = makeFile("played.txt");
    const otherFileB = makeFile("b.txt");
    const otherFileC = makeFile("c.txt");
    // the play is requested for the played file.
    const playPromise = testPool.pool.requestPlay({ file: playedFile }, [otherFileB, otherFileC]);
    // the pool starts a walk-to-end child for each other file; the test finishes both.
    await finishWalkToEnd(testPool, otherFileB);
    await finishWalkToEnd(testPool, otherFileC);
    const playOutcome = await playPromise;
    // both walk requests start at time 0 and pass stops.
    const walkRequests = testPool.held.getRequests();
    assert.equal(walkRequests.length, 2);
    for (const walkRequest of walkRequests) {
        assert.equal(walkRequest.startAt.getTime(), 0);
        assert.equal(walkRequest.isPassingStops, true);
    }
    // the play child starts after both walk children, and the play answer is passed on.
    assert.equal(testPool.eventLog.length, 3);
    assert.equal(testPool.eventLog[2], "play:/project/played.txt");
    assert.deepEqual(testPool.eventLog.slice(0, 2).sort(), ["walk:/project/b.txt", "walk:/project/c.txt"]);
    assert.equal(playOutcome.kind, PlayOutcomeKind.Replayed);
});

test("test_a_play_child_starts_only_after_the_pool_has_drained", async () => {
    // Scenario: a walk child is running when a play is requested; the play waits for it.
    // Steps:
    // a walk child of file x runs.
    const testPool = makeTestPool({ maxProcesses: 4 });
    const runningFile = makeFile("x.txt");
    testPool.pool.requestWalk(makeWalkRequest(runningFile, 10), true);
    await waitForCondition(() => testPool.held.hasOpenCallForFile(runningFile), WAIT_TIMEOUT_MILLISECONDS);
    // a play is requested with no other replay files.
    const playPromise = testPool.pool.requestPlay({ file: makeFile("played.txt") }, []);
    // the play child does not start while the walk child runs.
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    assert.equal(testPool.playedFiles.length, 0);
    // the walk child exits, then the play child starts.
    testPool.held.resolveCallNumber(0, makeCoveredOutcome());
    await playPromise;
    assert.deepEqual(testPool.eventLog, ["walk:/project/x.txt", "play:/project/played.txt"]);
});

test("test_no_pool_child_starts_while_a_play_child_runs", async () => {
    // Scenario: a walk request made during a play waits until the play child exits.
    // Steps:
    // the play child starts and stays open.
    const testPool = makeTestPool({ maxProcesses: 4, isPlayHeld: true });
    const playPromise = testPool.pool.requestPlay({ file: makeFile("played.txt") }, []);
    await waitForCondition(() => testPool.playedFiles.length === 1, WAIT_TIMEOUT_MILLISECONDS);
    // a walk request for file y is made during the play.
    const waitingFile = makeFile("y.txt");
    testPool.pool.requestWalk(makeWalkRequest(waitingFile, 10), true);
    // no walk child starts, and the file shows the Queued status.
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    assert.equal(testPool.held.getRequests().length, 0);
    assert.equal(listStatusesOfFile(testPool, waitingFile).at(-1), FileWalkStatus.Queued);
    // the play child exits, then the walk child of file y starts.
    testPool.releasePlay();
    await playPromise;
    await waitForCondition(() => testPool.held.hasOpenCallForFile(waitingFile), WAIT_TIMEOUT_MILLISECONDS);
    assert.deepEqual(testPool.eventLog, ["play:/project/played.txt", "walk:/project/y.txt"]);
    testPool.held.resolveCallNumber(0, makeCoveredOutcome());
    await testPool.pool.waitUntilIdle();
});

test("test_a_play_with_an_unfinished_other_file_does_not_start_the_play_child_and_answers_replay_refused", async () => {
    // Scenario: the walk-to-end child of another replay file ends without finishing the file.
    // Steps:
    // a play is requested with one other replay file that is not finished.
    const testPool = makeTestPool({ maxProcesses: 4 });
    const otherFile = makeFile("b.txt");
    const playPromise = testPool.pool.requestPlay({ file: makeFile("played.txt") }, [otherFile]);
    // the walk-to-end child of the other file crashes, so the file stays unfinished.
    await waitForCondition(() => testPool.held.hasOpenCallForFile(otherFile), WAIT_TIMEOUT_MILLISECONDS);
    testPool.held.resolveOpenCallOfFile(otherFile, makeCrashedOutcome());
    const playOutcome = await playPromise;
    // the answer is replay-refused with the reason naming the other file.
    assert.equal(playOutcome.kind, PlayOutcomeKind.ReplayRefused);
    assert.ok(playOutcome.reasonText!.startsWith(`the repo of ${otherFile.toString()} is not walked to its end:`));
    // the play child never started.
    assert.equal(testPool.playedFiles.length, 0);
});

test("test_a_play_for_a_replay_file_outside_the_layered_list_is_refused_before_any_child_starts", async () => {
    // Scenario: a replay file that the step program cannot walk refuses the play at once.
    // Steps:
    // the other replay file is not steppable.
    const otherFile = makeFile("outside.txt");
    const testPool = makeTestPool({ maxProcesses: 4, unsteppableFiles: [otherFile] });
    // a play is requested with that file in the walk-to-end list.
    const playOutcome = await testPool.pool.requestPlay({ file: makeFile("played.txt") }, [otherFile]);
    // the answer is replay-refused and the reason says the step program cannot walk the file.
    assert.equal(playOutcome.kind, PlayOutcomeKind.ReplayRefused);
    assert.ok(playOutcome.reasonText!.includes("the step program cannot walk"));
    // no walk child and no play child started.
    assert.equal(testPool.held.getRequests().length, 0);
    assert.equal(testPool.playedFiles.length, 0);
});

test("test_cancelFile_resolves_only_after_the_exit_of_the_child", async () => {
    // Scenario: cancelFile waits for the child to exit.
    // Steps:
    // a walk child runs, and the end signal does not make it exit until the test lets it.
    const testPool = makeTestPool({ maxProcesses: 4, isExitHeld: true });
    const file = makeFile("one.txt");
    testPool.pool.requestWalk(makeWalkRequest(file, 10), true);
    await waitForCondition(() => testPool.held.hasOpenCallForFile(file), WAIT_TIMEOUT_MILLISECONDS);
    // cancelFile is called and does not resolve while the child has not exited.
    let isCancelResolved = false;
    const cancelPromise = testPool.pool.cancelFile(file).then(() => {
        isCancelResolved = true;
    });
    await waitMilliseconds(NEGATIVE_WAIT_MILLISECONDS);
    assert.equal(isCancelResolved, false);
    // the child exits, and then cancelFile resolves.
    testPool.releaseChildExits();
    await cancelPromise;
    assert.equal(isCancelResolved, true);
    assert.equal(testPool.held.countOpenCalls(), 0);
});

test("test_the_pool_drops_the_outcome_of_a_cancelled_file", async () => {
    // Scenario: the outcome of a cancelled child is not reported, and the file goes back to Idle.
    // Steps:
    // a walk child runs.
    const testPool = makeTestPool({ maxProcesses: 4 });
    const file = makeFile("one.txt");
    testPool.pool.requestWalk(makeWalkRequest(file, 10), true);
    await waitForCondition(() => testPool.held.hasOpenCallForFile(file), WAIT_TIMEOUT_MILLISECONDS);
    // the file is cancelled; the fake end signal makes the child answer Crashed.
    await testPool.pool.cancelFile(file);
    await testPool.pool.waitUntilIdle();
    // onOutcome is never called, and the last status of the file is Idle.
    assert.equal(testPool.outcomeCalls.length, 0);
    assert.equal(listStatusesOfFile(testPool, file).at(-1), FileWalkStatus.Idle);
});

// The step pool of the terminal viewer: a limited number of step children, one child per file, and a play child that runs alone.

import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus } from "../../src/structures/vocabulary.ts";
import { runPlayRequest } from "./engineV3_tui_pool_play.ts";
import { mergeEntry, pickNextEntry, type PoolEntry } from "./engineV3_tui_pool_queue.ts";
import type { PlayOutcome, PlayRequest, StepPool, StepPoolOptions, StepProcessOutcome, StepRequest } from "./engineV3_tui_walk_types.ts";

const MAXIMUM_PROCESSES_ALLOWED = 4;

export function createStepPool(options: StepPoolOptions): StepPool {
    if (options.maxProcesses > MAXIMUM_PROCESSES_ALLOWED) {
        throw new Error(`maxProcesses ${options.maxProcesses} is above the limit of ${MAXIMUM_PROCESSES_ALLOWED}`);
    }
    if (options.maxProcesses < 1) {
        throw new Error(`maxProcesses ${options.maxProcesses} is below 1`);
    }
    const queueByFileValue = new Map<string, PoolEntry>();
    const pendingByFileValue = new Map<string, PoolEntry>();
    const runningRequestByFileValue = new Map<string, StepRequest>();
    const cancelledFileValues = new Set<string>();
    const idleResolvers: (() => void)[] = [];
    let isStartingStopped = false;
    let isPlayRunning = false;

    function setStatus(file: Path, status: FileWalkStatus): void {
        options.onStatusChange(file, { status, reasonText: undefined, failedReplayCount: 0 });
    }

    function isIdle(): boolean {
        if (runningRequestByFileValue.size > 0) {
            return false;
        }
        if (isPlayRunning) {
            return false;
        }
        if (isStartingStopped) {
            return true;
        }
        return queueByFileValue.size === 0;
    }

    function resolveIdleWaiters(): void {
        if (isIdle()) {
            for (const resolveWaiter of idleResolvers.splice(0)) {
                resolveWaiter();
            }
        }
    }

    function queueEntry(entry: PoolEntry): void {
        mergeEntry(queueByFileValue, entry);
        setStatus(entry.request.file, FileWalkStatus.Queued);
    }

    function stopStarting(): void {
        isStartingStopped = true;
    }

    function finishChild(request: StepRequest, outcome: StepProcessOutcome): void {
        const fileValue = request.file.value;
        runningRequestByFileValue.delete(fileValue);
        const isCancelled = cancelledFileValues.delete(fileValue);
        const pendingEntry = pendingByFileValue.get(fileValue);
        if (pendingEntry !== undefined) {
            pendingByFileValue.delete(fileValue);
            queueEntry(pendingEntry);
        }
        setStatus(request.file, FileWalkStatus.Idle);
        if (!isCancelled) {
            options.onOutcome(request, outcome);
        }
        startQueuedChildren();
        resolveIdleWaiters();
    }

    function startQueuedChildren(): void {
        while (queueByFileValue.size > 0) {
            if (isStartingStopped) {
                return;
            }
            if (isPlayRunning) {
                return;
            }
            if (runningRequestByFileValue.size >= options.maxProcesses) {
                return;
            }
            const entry = pickNextEntry(queueByFileValue);
            if (options.hasLogsGrown()) {
                stopStarting();
                options.onLogsGrew();
                return;
            }
            queueByFileValue.delete(entry.request.file.value);
            runningRequestByFileValue.set(entry.request.file.value, entry.request);
            setStatus(entry.request.file, FileWalkStatus.Running);
            options.spawnStepProcess(entry.request).then((outcome) => finishChild(entry.request, outcome));
        }
    }

    function requestWalk(request: StepRequest, isVisible: boolean): void {
        const entry: PoolEntry = { request, isVisible };
        if (runningRequestByFileValue.has(request.file.value)) {
            mergeEntry(pendingByFileValue, entry);
            return;
        }
        queueEntry(entry);
        startQueuedChildren();
    }

    function waitUntilIdle(): Promise<void> {
        if (isIdle()) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => idleResolvers.push(resolve));
    }

    function requestPlay(request: PlayRequest, walkToEndFiles: Path[]): Promise<PlayOutcome> {
        return runPlayRequest(request, walkToEndFiles, {
            isFileSteppable: options.isFileSteppable,
            isFileWalkFinished: options.isFileWalkFinished,
            spawnPlayProcess: options.spawnPlayProcess,
            requestWalk,
            waitUntilIdle,
            isIdle,
            setPlayRunning: (isRunning) => { isPlayRunning = isRunning; },
            releaseQueue: () => { startQueuedChildren(); resolveIdleWaiters(); },
        });
    }

    async function cancelFile(file: Path): Promise<void> {
        const fileValue = file.value;
        pendingByFileValue.delete(fileValue);
        if (queueByFileValue.delete(fileValue)) {
            setStatus(file, FileWalkStatus.Idle);
        }
        if (runningRequestByFileValue.has(fileValue)) {
            cancelledFileValues.add(fileValue);
        }
        await options.endChildOfFile(file);
    }

    async function cancelAll(): Promise<void> {
        for (const fileValue of runningRequestByFileValue.keys()) {
            cancelledFileValues.add(fileValue);
        }
        for (const entry of queueByFileValue.values()) {
            setStatus(entry.request.file, FileWalkStatus.Idle);
        }
        queueByFileValue.clear();
        pendingByFileValue.clear();
        await options.endAllChildren();
    }

    function listRunningFiles(): Path[] {
        return [...runningRequestByFileValue.values()].map((request) => request.file);
    }

    return { requestWalk, requestPlay, cancelFile, cancelAll, stopStarting, waitUntilIdle, listRunningFiles };
}

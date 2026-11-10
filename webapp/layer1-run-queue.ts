// Layer 1 run queue: replays the queued script runs one at a time.

import { openBusyShield, renderBusyShieldError } from "./layer1-components/popups/layer1-busy-shield.ts";
import { hideLayer1Progress, renderLayer1Progress } from "./layer1-components/loading-bar/layer1-progress.ts";
import { refreshRunConsole } from "./layer1-components/details-drawer/layer1-run-console.ts";
import { openRunConsent } from "./layer1-components/popups/layer1-run-consent.ts";
import { readDrawnView } from "./layer1-components/bubbles/layer1-diff-wash.ts";
import { refreshDrawnStage } from "./layer1-components/show-row/layer1-kind-filter.ts";
import { appendRunOutput, getRunOutcome, markRunCancelled, markRunStarted, renderRunDotsOfRun, storeRunResult } from "./layer1-run-results.ts";
import { clearNeedsCache, computeRunRoutes, runQueueState } from "./layer1-run-route.ts";
import { fetchScriptRun, type RunReply } from "./layer1-run-stream.ts";
import { WireRunOutcome, type WireScriptOutputLine } from "./layer1-wire-script-results.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const queue = runQueueState.queue;
const controllers = new Map<string, AbortController>();
let isWalking = false;
let finishedCount = 0;
let routeChain: Promise<void> = Promise.resolve();
let latestScroll: { view: WireLayer1View; ids: string[] } | undefined = undefined;

function stopWalking(): void {
  isWalking = false;
  runQueueState.runningId = undefined;
  finishedCount = 0;
  controllers.clear();
  hideLayer1Progress();
}

function reportQueueFailure(error: unknown): void {
  queue.length = 0;
  stopWalking();
  openBusyShield("script runs stopped");
  renderBusyShieldError(String(error));
}

function markRunRunning(run: WireScriptRun): AbortController {
  const controller = new AbortController();
  controllers.set(run.toolUseId, controller);
  runQueueState.runningId = run.toolUseId;
  markRunStarted(run.toolUseId);
  renderRunDotsOfRun(run.toolUseId);
  return controller;
}

function storeRunReply(view: WireLayer1View, run: WireScriptRun, reply: RunReply): void {
  controllers.delete(run.toolUseId);
  runQueueState.runningId = undefined;
  finishedCount += 1;
  if (reply.kind === "consent-required") {
    throw new Error("the server asked for consent after the page asked");
  }
  if (reply.kind === "result") {
    storeRunResult(view, reply.result);
  }
}

// After a result or cancel the saved answers are stale: ask again for the dots still on screen.
async function refreshViewport(toolUseId: string): Promise<void> {
  clearNeedsCache();
  refreshRunConsole(toolUseId);
  const isReplayed = getRunOutcome(toolUseId) === WireRunOutcome.replayed;
  if (isReplayed) {
    await refreshDrawnStage();
  }
  void addRunsToQueue(readDrawnView()!, latestScroll!.ids);
}

function appendOutputLine(toolUseId: string, line: WireScriptOutputLine): void {
  appendRunOutput(toolUseId, line.text);
  refreshRunConsole(toolUseId);
}

async function executeNextRun(view: WireLayer1View): Promise<void> {
  const run = queue.shift()!;
  const controller = markRunRunning(run);
  const step = `script runs: ${finishedCount + 1} of ${finishedCount + 1 + queue.length}`;
  renderLayer1Progress(step);
  const request = { sessionFile: run.sessionFile, toolUseId: run.toolUseId, allowScripts: true };
  const renderStep = (label: string, current?: number, total?: number): void => renderLayer1Progress(`${step} · ${label}`, current, total);
  const writeLine = (line: WireScriptOutputLine): void => appendOutputLine(run.toolUseId, line);
  const reply = await fetchScriptRun(request, renderStep, writeLine, controller.signal);
  storeRunReply(view, run, reply);
  await refreshViewport(run.toolUseId);
}

// A declined consent drops the queue before the loop starts.
async function executeQueue(view: WireLayer1View): Promise<void> {
  if (isWalking) {
    return;
  }
  isWalking = true;
  const isAllowed = await openRunConsent(view);
  if (!isAllowed) {
    queue.length = 0;
  }
  while (queue.length > 0) {
    await executeNextRun(readDrawnView()!);
  }
  stopWalking();
}

async function executeRoutePass(view: WireLayer1View, ids: string[]): Promise<void> {
  await computeRunRoutes(view, ids);
  const isQueued = queue.length > 0;
  if (isQueued) {
    void executeQueue(view).catch(reportQueueFailure);
  }
}

// One pass at a time, so at most one needs request is in flight.
export function addRunsToQueue(view: WireLayer1View, ids: string[]): Promise<void> {
  latestScroll = { view, ids };
  const executeThisPass = (): Promise<void> => executeRoutePass(view, ids);
  routeChain = routeChain.then(executeThisPass).catch(reportQueueFailure);
  return routeChain;
}

export function stopRun(toolUseId: string): void {
  const controller = controllers.get(toolUseId);
  if (controller === undefined) {
    throw new Error(`script ${toolUseId} is not running`);
  }
  markRunCancelled(toolUseId);
  renderRunDotsOfRun(toolUseId);
  controller.abort();
  refreshRunConsole(toolUseId);
}

export function resetRunQueue(): void {
  queue.length = 0;
  const runningId = runQueueState.runningId;
  if (runningId !== undefined) {
    controllers.get(runningId)?.abort();
  }
  clearNeedsCache();
}

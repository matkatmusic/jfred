// Layer 1 run route: queues a dot, or shows why it waits.

import { readDrawnView } from "./layer1-components/bubbles/layer1-diff-wash.ts";
import { getBasename } from "./layer1-components/details-drawer/layer1-diff-view.ts";
import { refreshDrawnStage } from "./layer1-components/show-row/layer1-kind-filter.ts";
import { renderBlockedPopup } from "./layer1-components/popups/layer1-run-blocked-popup.ts";
import {
  compareRunOrder, findBlockerDot, findFirstBlocker, isBlockerPending, isRunEligible, listOwnBubbleBlockers, listRunBubbles, mergeBlockers, type Blocker,
} from "./layer1-run-order.ts";
import { getCancelledRunIds, getRunOutcome, isRunnableRun, isRunStarted, markRunUnreplayed } from "./layer1-run-results.ts";
import { fetchScriptNeeds } from "./layer1-run-stream.ts";
import { WireNeedState, type WireNeededRun } from "./layer1-wire-script-results.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// Shared with the queue module: the runs waiting to start and the one running now.
export const runQueueState: { queue: WireScriptRun[]; runningId: string | undefined } = { queue: [], runningId: undefined };

const needsCache = new Map<string, WireNeededRun[]>();

export function clearNeedsCache(): void {
  needsCache.clear();
}

function listQueuedIds(): string[] {
  const ids: string[] = [];
  for (const run of runQueueState.queue) {
    ids.push(run.toolUseId);
  }
  return ids;
}

function findViewRun(view: WireLayer1View, id: string): WireScriptRun | undefined {
  for (const pair of view.pairs) {
    for (const run of pair.scriptRuns ?? []) {
      if (run.toolUseId === id) {
        return run;
      }
    }
  }
  return undefined;
}

function isRunTaken(id: string): boolean {
  const isActive = isRunStarted(id) || id === runQueueState.runningId;
  return isActive || listQueuedIds().includes(id);
}

function listQueueableRuns(view: WireLayer1View, ids: string[]): WireScriptRun[] {
  const runs: WireScriptRun[] = [];
  for (const id of ids) {
    const run = findViewRun(view, id);
    const isQueueable = run !== undefined && isRunnableRun(run) && !isRunTaken(id);
    if (isQueueable) {
      runs.push(run);
    }
  }
  return runs.sort(compareRunOrder);
}

async function readNeeds(run: WireScriptRun): Promise<WireNeededRun[]> {
  const isCached = needsCache.has(run.toolUseId);
  if (!isCached) {
    const request = { sessionFile: run.sessionFile, toolUseId: run.toolUseId };
    const reply = await fetchScriptNeeds(request, new AbortController().signal);
    needsCache.set(run.toolUseId, reply.needs);
  }
  return needsCache.get(run.toolUseId)!;
}

// The server is the truth: a run it lists as unreplayed loses the page's result.
function isNeedStale(need: WireNeededRun): boolean {
  const id = need.toolUseId;
  const isHeld = isRunStarted(id) || getRunOutcome(id) !== undefined;
  const isIdle = id !== runQueueState.runningId && !getCancelledRunIds().has(id);
  return isHeld && isIdle && need.state === WireNeedState.unreplayed;
}

function resetStaleNeeds(view: WireLayer1View, needs: WireNeededRun[]): boolean {
  let didReset = false;
  for (const need of needs) {
    const isStale = isNeedStale(need);
    if (isStale) {
      markRunUnreplayed(view, need.toolUseId);
      didReset = true;
    }
  }
  return didReset;
}

function moveToBlocker(blocker: Blocker): void {
  const dot = findBlockerDot(blocker);
  if (dot === undefined) {
    throw new Error(`no dot found for script ${blocker.toolUseId}`);
  }
  dot.scrollIntoView({ block: "center", inline: "center" });
}

function renderFirstBlocker(view: WireLayer1View, run: WireScriptRun, first: Blocker): void {
  const isPending = isBlockerPending(first, listQueuedIds(), runQueueState.runningId);
  const dotKey = `${run.toolUseId}|${listRunBubbles(view, run.toolUseId)[0]}`;
  const moveToFirst = (): void => moveToBlocker(first);
  if (!isPending) {
    const blockerBubble = listRunBubbles(view, first.toolUseId)[0];
    if (blockerBubble === undefined) {
      throw new Error(`no bubble for script ${first.toolUseId}`);
    }
    renderBlockedPopup(dotKey, run.toolUseId, first, getBasename(blockerBubble), moveToFirst);
  }
}

function applyRunRoute(view: WireLayer1View, run: WireScriptRun, needs: WireNeededRun[]): void {
  const blockers = mergeBlockers(listOwnBubbleBlockers(view, run), needs, getCancelledRunIds());
  const isEligible = isRunEligible(blockers);
  if (isEligible) {
    runQueueState.queue.push(run);
    runQueueState.queue.sort(compareRunOrder);
    return;
  }
  renderFirstBlocker(view, run, findFirstBlocker(blockers)!);
}

// True when a stale need was reset, so the caller must redraw and route again.
async function applyRoutesToQueueableRuns(view: WireLayer1View, ids: string[]): Promise<boolean> {
  let didReset = false;
  for (const run of listQueueableRuns(view, ids)) {
    const needs = await readNeeds(run);
    const didResetNeed = resetStaleNeeds(view, needs);
    if (didResetNeed) {
      didReset = true;
    }
    else {
      applyRunRoute(view, run, needs);
    }
  }
  return didReset;
}

// Eligible dots join the queue in time order; blocked dots show a popup. One needs request at a time.
export async function computeRunRoutes(view: WireLayer1View, ids: string[]): Promise<void> {
  const didReset = await applyRoutesToQueueableRuns(view, ids);
  if (didReset) {
    await refreshDrawnStage();
    await computeRunRoutes(readDrawnView()!, ids);
  }
}

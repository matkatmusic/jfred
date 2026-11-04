// Layer 1 run order: which earlier script dots a dot must wait for.

import { getRunOutcome, isRunnableRun } from "./layer1-run-results.ts";
import { WireNeedState, WireRunOutcome, type WireNeededRun } from "./layer1-wire-script-results.ts";
import type { WireScriptRun } from "./layer1-wire-script-runs.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// The server only knows unreplayed and replay-failed; the page adds cancelled.
export const BlockerState = { unreplayed: "unreplayed", crashed: "crashed", cancelled: "cancelled" } as const;
export type BlockerState = (typeof BlockerState)[keyof typeof BlockerState];

export type RunOrderKey = { instant: string; sessionFile: string; line?: number };
export type Blocker = RunOrderKey & { toolUseId: string; state: BlockerState };

const FINISHED_OUTCOMES: ReadonlySet<WireRunOutcome> = new Set([WireRunOutcome.replayed, WireRunOutcome.originalFailed, WireRunOutcome.notReplayed]);

// Same order as compareEditEvents in src/layer1_edit_events.ts.
export function compareRunOrder(a: RunOrderKey, b: RunOrderKey): number {
  const byInstant = Date.parse(a.instant) - Date.parse(b.instant);
  if (byInstant !== 0) {
    return byInstant;
  }
  const bySessionFile = a.sessionFile.localeCompare(b.sessionFile);
  if (bySessionFile !== 0) {
    return bySessionFile;
  }
  return (a.line ?? 0) - (b.line ?? 0);
}

function isRunCarriedBy(pair: { scriptRuns?: WireScriptRun[] }, toolUseId: string): boolean {
  for (const run of pair.scriptRuns ?? []) {
    const isMatch = run.toolUseId === toolUseId;
    if (isMatch) {
      return true;
    }
  }
  return false;
}

export function listRunBubbles(view: WireLayer1View, toolUseId: string): string[] {
  const bubbles: string[] = [];
  for (const pair of view.pairs) {
    const isInBubble = isRunCarriedBy(pair, toolUseId);
    if (isInBubble) {
      bubbles.push(pair.path);
    }
  }
  return bubbles;
}

function isEarlierRunBlocking(run: WireScriptRun): boolean {
  const outcome = getRunOutcome(run.toolUseId);
  const isRelevant = isRunnableRun(run) || outcome !== undefined;
  if (!isRelevant) {
    return false;
  }
  return outcome === undefined || !FINISHED_OUTCOMES.has(outcome);
}

function buildBlocker(source: RunOrderKey & { toolUseId: string }, isCrashed: boolean): Blocker {
  const state = isCrashed ? BlockerState.crashed : BlockerState.unreplayed;
  return { toolUseId: source.toolUseId, sessionFile: source.sessionFile, line: source.line, instant: source.instant, state };
}

function buildOwnBlocker(run: WireScriptRun): Blocker {
  return buildBlocker(run, getRunOutcome(run.toolUseId) === WireRunOutcome.replayFailed);
}

function collectBubbleBlockers(blockers: Map<string, Blocker>, runs: WireScriptRun[], run: WireScriptRun): void {
  for (const candidate of runs) {
    const isEarlier = compareRunOrder(candidate, run) < 0;
    const isBlocking = isEarlier && isEarlierRunBlocking(candidate);
    if (isBlocking) {
      blockers.set(candidate.toolUseId, buildOwnBlocker(candidate));
    }
  }
}

// Set 1: every earlier runnable dot in every bubble of the run.
export function listOwnBubbleBlockers(view: WireLayer1View, run: WireScriptRun): Blocker[] {
  const bubbles = new Set(listRunBubbles(view, run.toolUseId));
  const blockers = new Map<string, Blocker>();
  for (const pair of view.pairs) {
    const isOwnBubble = bubbles.has(pair.path);
    if (isOwnBubble) {
      collectBubbleBlockers(blockers, pair.scriptRuns ?? [], run);
    }
  }
  return [...blockers.values()];
}

function buildNeedBlocker(need: WireNeededRun): Blocker {
  return buildBlocker(need, need.state === WireNeedState.replayFailed);
}

function addBlocker(byId: Map<string, Blocker>, blocker: Blocker): void {
  const existing = byId.get(blocker.toolUseId);
  if (existing === undefined) {
    byId.set(blocker.toolUseId, blocker);
    return;
  }
  const isCrashed = existing.state === BlockerState.crashed || blocker.state === BlockerState.crashed;
  existing.state = isCrashed ? BlockerState.crashed : BlockerState.unreplayed;
}

// The union of own-bubble blockers and server needs, one per run; a page cancel wins.
export function mergeBlockers(own: Blocker[], needs: WireNeededRun[], cancelledIds: ReadonlySet<string>): Blocker[] {
  const byId = new Map<string, Blocker>();
  for (const blocker of own) {
    addBlocker(byId, { ...blocker });
  }
  for (const need of needs) {
    addBlocker(byId, buildNeedBlocker(need));
  }
  const merged: Blocker[] = [];
  for (const blocker of byId.values()) {
    const isCancelled = cancelledIds.has(blocker.toolUseId);
    merged.push(isCancelled ? { ...blocker, state: BlockerState.cancelled } : blocker);
  }
  return merged;
}

export function isRunEligible(blockers: Blocker[]): boolean {
  return blockers.length === 0;
}

export function findFirstBlocker(blockers: Blocker[]): Blocker | undefined {
  return [...blockers].sort(compareRunOrder)[0];
}

export function findBlockerDot(blocker: Blocker): HTMLElement | undefined {
  for (const dot of document.querySelectorAll<HTMLElement>("i.node.n-script[data-tool-use-id]")) {
    const isBlockerDot = dot.getAttribute("data-tool-use-id") === blocker.toolUseId;
    if (isBlockerDot) {
      return dot;
    }
  }
  return undefined;
}

export function isBlockerPending(blocker: Blocker, queuedIds: Iterable<string>, runningId: string | undefined): boolean {
  const isRunning = blocker.toolUseId === runningId;
  return isRunning || [...queuedIds].includes(blocker.toolUseId);
}

// Layer 1 run results: one stored result per run, painted on every dot of that run.

import { WireScriptExecutorKind, type WireScriptRun } from "./layer1-wire-script-runs.ts";
import { WireScriptLanguage } from "./layer1-components/details-drawer/layer1-script-language.ts";
import { buildRunMarkMarkup, RunMarkKey } from "./layer1-components/bubbles/layer1-run-dot-marks.ts";
import { WireConfidence } from "./layer1-wire-edits.ts";
import { WireRunOutcome, type WireScriptResult } from "./layer1-wire-script-results.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const startedRuns = new Set<string>();
const cancelledRuns = new Set<string>();
const resultsByRun = new Map<string, WireScriptResult>();
const outputByRun = new Map<string, string>();

const RUN_DOT_SELECTOR = "i.node.n-script[data-tool-use-id]";
const RUN_STATE_PREFIX = "run-state-";
const RUN_END_PREFIX = "run-end-";
// const RUN_STATE_CONFIDENCES: ReadonlySet<WireConfidence> = new Set([
//   WireConfidence.verified,
//   WireConfidence.mismatch,
//   WireConfidence.originalFailed,
//   WireConfidence.injectedUnverified,
// ]);
const RATING_MARK_KEYS: ReadonlyMap<WireConfidence, RunMarkKey> = new Map([
  [WireConfidence.verified, RunMarkKey.verified],
  [WireConfidence.mismatch, RunMarkKey.mismatch],
  [WireConfidence.originalFailed, RunMarkKey.originalFailed],
  [WireConfidence.injectedUnverified, RunMarkKey.injectedUnverified],
]);
const RUN_END_KEYS_BY_OUTCOME: Record<WireRunOutcome, RunMarkKey> = {
  [WireRunOutcome.replayed]: RunMarkKey.replayed,
  [WireRunOutcome.replayFailed]: RunMarkKey.replayFailed,
  [WireRunOutcome.notReplayed]: RunMarkKey.notReplayed,
  [WireRunOutcome.originalFailed]: RunMarkKey.originalFailed,
};

export function markRunStarted(id: string): void {
  startedRuns.add(id);
}

export function isRunStarted(id: string): boolean {
  return startedRuns.has(id);
}

export function markRunCancelled(id: string): void {
  cancelledRuns.add(id);
}

export function getCancelledRunIds(): ReadonlySet<string> {
  return cancelledRuns;
}

export function appendRunOutput(id: string, text: string): void {
  outputByRun.set(id, getRunOutput(id) + text);
}

export function getRunOutput(id: string): string {
  return outputByRun.get(id) ?? "";
}

export function getRunResult(id: string): WireScriptResult | undefined {
  return resultsByRun.get(id);
}

export function getRunOutcome(id: string): WireRunOutcome | undefined {
  return resultsByRun.get(id)?.outcome;
}

export function isRunnableRun(run: WireScriptRun): boolean {
  const isPythonKind = run.executorKind === WireScriptExecutorKind.python;
  const isPythonLanguage = run.language === WireScriptLanguage.python || run.language === WireScriptLanguage.python3;
  return isPythonKind && isPythonLanguage && run.confidence === undefined;
}

function listViewRuns(view: WireLayer1View, id: string): { path: string; run: WireScriptRun }[] {
  const entries: { path: string; run: WireScriptRun }[] = [];
  for (const pair of view.pairs) {
    for (const run of pair.scriptRuns ?? []) {
      if (run.toolUseId === id) {
        entries.push({ path: pair.path, run });
      }
    }
  }
  return entries;
}

function listRunDots(id: string): HTMLElement[] {
  const dots: HTMLElement[] = [];
  for (const dot of document.querySelectorAll<HTMLElement>(RUN_DOT_SELECTOR)) {
    const isRunDot = dot.getAttribute("data-tool-use-id") === id;
    if (isRunDot) {
      dots.push(dot);
    }
  }
  return dots;
}

function readBubblePath(dot: HTMLElement): string | undefined {
  const name = dot.closest(".filebox")?.querySelector(".fname");
  return name?.getAttribute("data-path") ?? undefined;
}

function clearRunDotPaint(dot: HTMLElement): void {
  for (const className of [...dot.classList]) {
    const isRunPaintClass = className.startsWith(RUN_STATE_PREFIX) || className.startsWith(RUN_END_PREFIX);
    if (isRunPaintClass) {
      dot.classList.remove(className);
    }
  }
  for (const mark of dot.querySelectorAll(".run-mark")) {
    mark.remove();
  }
}

function readRunEndKey(id: string): RunMarkKey {
  const outcome = getRunOutcome(id);
  if (outcome !== undefined) {
    return RUN_END_KEYS_BY_OUTCOME[outcome];
  }
  if (cancelledRuns.has(id)) {
    return RunMarkKey.cancelled;
  }
  if (startedRuns.has(id)) {
    return RunMarkKey.running;
  }
  return RunMarkKey.notRun;
}

// Every script dot calls this when drawn or redrawn; a bash dot keeps its own look.
export function paintRunDot(dot: HTMLElement, rating: WireConfidence | undefined): void {
  if (dot.classList.contains("never-provable")) {
    return;
  }
  clearRunDotPaint(dot);
  const endKey = readRunEndKey(dot.getAttribute("data-tool-use-id")!);
  dot.classList.add(`${RUN_END_PREFIX}${endKey}`);
  let markKey = endKey;
  if (rating !== undefined) {
    dot.classList.add(`${RUN_STATE_PREFIX}${rating}`);
    const ratingMarkKey = RATING_MARK_KEYS.get(rating);
    if (ratingMarkKey !== undefined) {
      markKey = ratingMarkKey;
    }
  }
  dot.insertAdjacentHTML("beforeend", buildRunMarkMarkup(markKey));
}

function readDotRating(result: WireScriptResult | undefined, dot: HTMLElement): WireConfidence | undefined {
  const path = readBubblePath(dot);
  for (const file of result?.files ?? []) {
    const isDotFile = file.path === path;
    if (isDotFile) {
      const isRating = RATING_MARK_KEYS.has(file.confidence);
      if (isRating) {
        return file.confidence;
      }
    }
  }
  return undefined;
}

// The queue calls this after a start or a cancel; storeRunResult and markRunUnreplayed call it themselves.
export function paintRunDotsOfRun(id: string): void {
  const result = resultsByRun.get(id);
  for (const dot of listRunDots(id)) {
    paintRunDot(dot, readDotRating(result, dot));
  }
}

// function clearRunStateClass(dot: HTMLElement): void {
//   for (const className of [...dot.classList]) {
//     const isRunStateClass = className.startsWith(RUN_STATE_PREFIX);
//     if (isRunStateClass) {
//       dot.classList.remove(className);
//     }
//   }
// }
//
// function applyRunDotState(dot: HTMLElement, confidence: WireConfidence): void {
//   clearRunStateClass(dot);
//   const isStateConfidence = RUN_STATE_CONFIDENCES.has(confidence);
//   if (isStateConfidence) {
//     dot.classList.add(`${RUN_STATE_PREFIX}${confidence}`);
//   }
// }

function writeRunConfidence(entries: { path: string; run: WireScriptRun }[], path: string, confidence: WireConfidence): void {
  for (const entry of entries) {
    if (entry.path === path) {
      entry.run.confidence = confidence;
    }
  }
}

// function applyRunDotsState(dots: HTMLElement[], path: string, confidence: WireConfidence): void {
//   for (const dot of dots) {
//     const isInBubble = readBubblePath(dot) === path;
//     if (isInBubble) {
//       applyRunDotState(dot, confidence);
//     }
//   }
// }

export function storeRunResult(view: WireLayer1View, result: WireScriptResult): void {
  resultsByRun.set(result.toolUseId, result);
  const entries = listViewRuns(view, result.toolUseId);
  for (const file of result.files) {
    writeRunConfidence(entries, file.path, file.confidence);
  }
  paintRunDotsOfRun(result.toolUseId);
}

export function markRunUnreplayed(view: WireLayer1View, id: string): void {
  startedRuns.delete(id);
  resultsByRun.delete(id);
  outputByRun.delete(id);
  for (const entry of listViewRuns(view, id)) {
    delete entry.run.confidence;
  }
  paintRunDotsOfRun(id);
}

export function resetRunResults(): void {
  startedRuns.clear();
  cancelledRuns.clear();
  resultsByRun.clear();
  outputByRun.clear();
}

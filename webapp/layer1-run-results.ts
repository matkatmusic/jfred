// Layer 1 run results: one stored result per run, painted on every dot of that run.

import { WireScriptExecutorKind, type WireScriptRun } from "./layer1-wire-script-runs.ts";
import { WireScriptLanguage } from "./layer1-script-language.ts";
import { WireConfidence } from "./layer1-wire-edits.ts";
import type { WireRunOutcome, WireScriptResult } from "./layer1-wire-script-results.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

const startedRuns = new Set<string>();
const cancelledRuns = new Set<string>();
const resultsByRun = new Map<string, WireScriptResult>();
const outputByRun = new Map<string, string>();

const RUN_STATE_PREFIX = "run-state-";
const RUN_STATE_CONFIDENCES: ReadonlySet<WireConfidence> = new Set([
  WireConfidence.verified,
  WireConfidence.mismatch,
  WireConfidence.originalFailed,
  WireConfidence.injectedUnverified,
]);

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
  for (const dot of document.querySelectorAll<HTMLElement>("i.node.n-script[data-tool-use-id]")) {
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

function clearRunStateClass(dot: HTMLElement): void {
  for (const className of [...dot.classList]) {
    const isRunStateClass = className.startsWith(RUN_STATE_PREFIX);
    if (isRunStateClass) {
      dot.classList.remove(className);
    }
  }
}

function applyRunDotState(dot: HTMLElement, confidence: WireConfidence): void {
  clearRunStateClass(dot);
  const isStateConfidence = RUN_STATE_CONFIDENCES.has(confidence);
  if (isStateConfidence) {
    dot.classList.add(`${RUN_STATE_PREFIX}${confidence}`);
  }
}

function writeRunConfidence(entries: { path: string; run: WireScriptRun }[], path: string, confidence: WireConfidence): void {
  for (const entry of entries) {
    if (entry.path === path) {
      entry.run.confidence = confidence;
    }
  }
}

function applyRunDotsState(dots: HTMLElement[], path: string, confidence: WireConfidence): void {
  for (const dot of dots) {
    const isInBubble = readBubblePath(dot) === path;
    if (isInBubble) {
      applyRunDotState(dot, confidence);
    }
  }
}

export function storeRunResult(view: WireLayer1View, result: WireScriptResult): void {
  resultsByRun.set(result.toolUseId, result);
  const entries = listViewRuns(view, result.toolUseId);
  const dots = listRunDots(result.toolUseId);
  for (const file of result.files) {
    writeRunConfidence(entries, file.path, file.confidence);
    applyRunDotsState(dots, file.path, file.confidence);
  }
}

export function markRunUnreplayed(view: WireLayer1View, id: string): void {
  startedRuns.delete(id);
  resultsByRun.delete(id);
  outputByRun.delete(id);
  for (const entry of listViewRuns(view, id)) {
    delete entry.run.confidence;
  }
  for (const dot of listRunDots(id)) {
    clearRunStateClass(dot);
  }
}

export function resetRunResults(): void {
  startedRuns.clear();
  cancelledRuns.clear();
  resultsByRun.clear();
  outputByRun.clear();
}

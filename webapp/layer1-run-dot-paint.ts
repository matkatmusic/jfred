// Layer 1 run dot paint helpers: find dots, clear paint, pick a file's mark.

import { RunMarkKey } from "./layer1-components/bubbles/layer1-run-dot-marks.ts";
import { WireConfidence } from "./layer1-wire-edits.ts";
import { WireFileChange, type WireScriptResult } from "./layer1-wire-script-results.ts";

export const RUN_STATE_PREFIX = "run-state-";
export const RUN_END_PREFIX = "run-end-";
const RUN_DOT_SELECTOR = "i.node.n-script[data-tool-use-id]";
export const RATING_MARK_KEYS: ReadonlyMap<WireConfidence, RunMarkKey> = new Map([
  [WireConfidence.verified, RunMarkKey.verified],
  [WireConfidence.mismatch, RunMarkKey.mismatch],
  [WireConfidence.originalFailed, RunMarkKey.originalFailed],
  [WireConfidence.injectedUnverified, RunMarkKey.injectedUnverified],
]);
const CHANGE_MARK_KEYS: ReadonlyMap<WireFileChange, RunMarkKey> = new Map([
  [WireFileChange.deleted, RunMarkKey.deleted],
  [WireFileChange.changedNotText, RunMarkKey.changedNotText],
]);

export function listRunDots(id: string): HTMLElement[] {
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

export function clearRunDotPaint(dot: HTMLElement): void {
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

export function findDotFile(result: WireScriptResult | undefined, dot: HTMLElement): WireScriptResult["files"][number] | undefined {
  const path = readBubblePath(dot);
  for (const file of result?.files ?? []) {
    const isDotFile = file.path === path;
    if (isDotFile) {
      return file;
    }
  }
  return undefined;
}

// Only a rating that has its own mark paints a run-state class.
export function readFileRating(file: WireScriptResult["files"][number] | undefined): WireConfidence | undefined {
  if (file?.confidence === undefined) {
    return undefined;
  }
  const isRating = RATING_MARK_KEYS.has(file.confidence);
  if (isRating) {
    return file.confidence;
  }
  return undefined;
}

// Deleted and not-text files get their own mark, then a rating mark, then the run-end mark.
export function readDotMarkKey(endKey: RunMarkKey, rating: WireConfidence | undefined, change: WireFileChange | undefined): RunMarkKey {
  const changeMarkKey = change === undefined ? undefined : CHANGE_MARK_KEYS.get(change);
  if (changeMarkKey !== undefined) {
    return changeMarkKey;
  }
  const ratingMarkKey = rating === undefined ? undefined : RATING_MARK_KEYS.get(rating);
  return ratingMarkKey ?? endKey;
}

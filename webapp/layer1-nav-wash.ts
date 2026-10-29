// Task 333: the File Nav selection's own wash — oldest→newest event across the selected files' drawn ladders.

import { getRequiredElementById } from "./app-dom.ts";
import { axisPixelsForInstant } from "./layer1-diff-wash.ts";
import { RULER_NODE_ROW_PIXELS } from "./layer1-ruler-axis.ts";
import { spawnWash } from "./layer1-wash.ts";
import { listOrphanLadderInstants, listPairLadderInstants } from "./layer1-wire-ladder.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// ponytail: gitOrphans excluded per the brief's ladder list; add them here if that scope changes.
export function computeNavWashInstants(view: WireLayer1View, targets: readonly string[]): { oldest: string; newest: string } | undefined {
  const selected = new Set(targets);
  const instants: string[] = [];
  for (const pair of view.pairs) {
    const isSelected = selected.has(pair.path);
    if (isSelected) {
      instants.push(...listPairLadderInstants(pair));
    }
  }
  for (const orphan of view.diskOrphans) {
    const isSelected = selected.has(orphan.path);
    if (isSelected) {
      instants.push(...listOrphanLadderInstants(orphan));
    }
  }
  if (instants.length === 0) {
    return undefined;
  }
  const range = { oldest: instants[0]!, newest: instants[0]! };
  for (const instant of instants) {
    const isOlder = Date.parse(instant) < Date.parse(range.oldest);
    const isNewer = Date.parse(instant) > Date.parse(range.newest);
    if (isOlder) {
      range.oldest = instant;
    }
    if (isNewer) {
      range.newest = instant;
    }
  }
  return range;
}

export function clearNavWash(): void {
  for (const wash of document.querySelectorAll(".nav-wash")) {
    wash.remove();
  }
}

// Every stage render replaces #washes wholesale, so this repaints fresh each time, not just on selection change.
export function renderNavWash(view: WireLayer1View, targets: readonly string[]): void {
  clearNavWash();
  const range = computeNavWashInstants(view, targets);
  if (range === undefined) {
    return;
  }
  const topPx = axisPixelsForInstant(range.oldest, view.ruler) - RULER_NODE_ROW_PIXELS / 2;
  const footPx = axisPixelsForInstant(range.newest, view.ruler) + RULER_NODE_ROW_PIXELS / 2;
  const wash = spawnWash(topPx, footPx, "var(--c-commit)");
  wash.classList.add("nav-wash");
  getRequiredElementById("washes").append(wash);
}

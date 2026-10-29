// Task 329: the File Nav's detail pipeline plus the shift-click range gesture — one DiffView per file.

import { getRequiredElementById } from "./app-dom.ts";
import { DiffPaneMode } from "./layer1-diff-pane.ts";
import { buildDiffView, renderDetailView,syncFoldAllLabel } from "./layer1-diff-view.ts";
import { clearDiffPair, setDrawerTools } from "./layer1-drawer-diff.ts";
import { listDatedSteps, listDiffableSteps } from "./layer1-drawer-steps.ts";
import { hasInstantInRange, resolveRangeStepIndexes } from "./layer1-range-steps.ts";
import { storeOpenedNode } from "./layer1-node-link.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

// A shift-clicked pair resolves to two global instants; each file diffs across that range.
export type DiffWashRange = { baseInstant: string; targetInstant: string };

function listStepInstants(view: WireLayer1View, path: string): string[] {
  const instants: string[] = [];
  for (const entry of listDatedSteps(view, path)) {
    instants.push(entry.instant);
  }
  return instants;
}

// One file's pane inside a range: its base/target derive from the wash, or an empty-range body.
function buildRangeView(view: WireLayer1View, path: string, range: DiffWashRange): HTMLElement {
  const indexes = resolveRangeStepIndexes(listStepInstants(view, path), range.baseInstant, range.targetInstant);
  if (indexes === undefined) {
    return buildDiffView(path, [], {
      revisionControlsShown: false, mode: DiffPaneMode.inline, fullContents: false,
      baseIndex: 0, targetIndex: 0, emptyText: "No state inside the selected range.",
    });
  }
  return buildDiffView(path, listDiffableSteps(view, path), {
    revisionControlsShown: true, mode: DiffPaneMode.inline, fullContents: false,
    baseIndex: indexes.baseIndex, targetIndex: indexes.targetIndex,
  });
}

// Files in, self-contained panes out; a range switches each pane from on-disk to its wash pair.
export function createDetailViewsForFiles(view: WireLayer1View, files: string[], range?: DiffWashRange): HTMLElement[] {
  const panes: HTMLElement[] = [];
  for (const path of [...files].sort()) {
    if (range !== undefined) {
      panes.push(buildRangeView(view, path, range));
      continue;
    }
    const steps = listDiffableSteps(view, path);
    panes.push(buildDiffView(path, steps, {
      // A lone selection has nothing to step or widen; 2+ files justify the revision controls.
      revisionControlsShown: files.length > 1,
      mode: DiffPaneMode.inline,
      fullContents: true,
      baseIndex: Math.max(0, steps.length - 1),
      targetIndex: Math.max(0, steps.length - 1),
    }));
  }
  return panes;
}

// A path belongs in the wash's swept-in set iff one of its OWN diffable steps lands inside the range.
function isPathTouchingRange(view: WireLayer1View, path: string, range: DiffWashRange): boolean {
  return hasInstantInRange(listStepInstants(view, path), range.baseInstant, range.targetInstant);
}

// Task 336: every pair/disk-orphan path with a step inside the range, plus whatever the caller always wants shown.
export function listWashFiles(view: WireLayer1View, range: DiffWashRange, alwaysInclude: string[]): string[] {
  const candidates: string[] = [];
  for (const pair of view.pairs) {
    candidates.push(pair.path);
  }
  for (const orphan of view.diskOrphans) {
    candidates.push(orphan.path);
  }
  const swept: string[] = [];
  for (const path of candidates) {
    const isTouching = isPathTouchingRange(view, path, range);
    if (isTouching) {
      swept.push(path);
    }
  }
  return [...new Set([...swept, ...alwaysInclude])].sort();
}

// The File Nav entry point: chrome, then the two-step pipeline above.
export function openDetailViewForFiles(view: WireLayer1View, targets: string[]): void {
  clearDiffPair();
  storeOpenedNode(undefined);
  setDrawerTools("none");
  // The single-node ↑↓ step a stale timeline anchor, so the nav flow hides them.
  getRequiredElementById("dprev").hidden = true;
  getRequiredElementById("dnext").hidden = true;
  const sorted = [...targets].sort();
  const header = getRequiredElementById("dpath");
  // A lone file is named ONCE, here; its section plate is removed by renderDetailView.
  header.textContent = sorted.length === 1
    ? `${sorted[0]!.split("/").pop()} — Current on-disk state`
    : `${sorted.length} files — Current on-disk state`;
  header.title = sorted.join("\n");
  getRequiredElementById("dmeta").textContent = `working tree   ·   ${sorted.length} selected`;
  renderDetailView(createDetailViewsForFiles(view, sorted));
}

// The one fold button closes every section while any is open, else opens them all.
function toggleEverySection(): void {
  const sections = document.querySelectorAll<HTMLDetailsElement>("#dbody details.dfile");
  let anyOpen = false;
  for (const section of sections) {
    if (section.open) {
      anyOpen = true;
    }
  }
  for (const section of sections) {
    section.open = !anyOpen;
  }
  syncFoldAllLabel();
}

export function installMultiFileDrawer(): void {
  // getRequiredElementById("dcollapse-all").addEventListener("click", () => setEverySectionOpen(false));
  // getRequiredElementById("dshow-all").addEventListener("click", () => setEverySectionOpen(true));
  getRequiredElementById("dfold-all").addEventListener("click", toggleEverySection);
  // `toggle` does not bubble, so listen in the capture phase.
  getRequiredElementById("dbody").addEventListener("toggle", syncFoldAllLabel, true);
}

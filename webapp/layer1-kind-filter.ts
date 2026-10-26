// Task 360: the show row's checkboxes hide node kinds by CSS attribute; no relayout, no refetch.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { hasLoadedBranches, loadBranchesOnce } from "./layer1-branches.ts";
import { hasLoadedEdits, loadEditsOnce } from "./layer1-edits.ts";
import { hasLoadedScriptRuns, loadScriptRunsOnce } from "./layer1-script-runs.ts";
import { LAYER1_PROGRESS_LABEL_DRAWING_EDITS, hideLayer1Progress, showLayer1Progress, waitForPaintedFrame } from "./layer1-progress.ts";
import { getHiddenKindsForProject, saveHiddenKinds } from "./layer1-settings.ts";
import { ShowRowKind, renderShowRow } from "./layer1-show-row.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

export const KIND_HIDDEN_CLASS = "kind-hidden";

// The HIDDEN kinds, not the shown ones, so a kind that appears later defaults to visible.
let hiddenKinds = new Set<ShowRowKind>();

// Registered by layer1-tick-files.ts so the ruler follows the boxes without an import cycle.
let notifyKindFilterChange: () => void = () => {};

export function onKindFilterChange(callback: () => void): void {
  notifyKindFilterChange = callback;
}

// Registered by layer1-kind-jump.ts so its arrows follow the boxes without an import cycle.
let notifyKindBoxToggle: () => void = () => {};

export function onKindBoxToggle(callback: () => void): void {
  notifyKindBoxToggle = callback;
}

export function isKindHidden(kind: ShowRowKind | undefined): boolean {
  return kind !== undefined && hiddenKinds.has(kind);
}

function applyHiddenKindsAttribute(): void {
  document.querySelector(".viz-root")!.setAttribute("data-hidden-kinds", [...hiddenKinds].join(" "));
}

// Task 343: the view and redraw the Edit box uses; each render sets them.
let drawnView: WireLayer1View | undefined;
let redrawStage: (() => void | Promise<void>) | undefined;

async function toggleKindBox(box: HTMLInputElement): Promise<void> {
  const kind = Object.values(ShowRowKind).find((candidate) => candidate === box.dataset["kind"])!;
  if (kind === ShowRowKind.edit && box.checked && !hasLoadedEdits(drawnView!)) {
    const isLoaded = await loadEditsOnce(drawnView!);
    if (!isLoaded) {
      box.checked = false;
      return;
    }
    // The kind shows before the redraw so edit nodes appear as drawn; the bar stays up.
    showLayer1Progress(LAYER1_PROGRESS_LABEL_DRAWING_EDITS);
    await waitForPaintedFrame();
    hiddenKinds.delete(kind);
    applyHiddenKindsAttribute();
    await redrawStage!();
    hideLayer1Progress();
    return;
  }
  if (kind === ShowRowKind.scriptRun && box.checked && !hasLoadedScriptRuns(drawnView!)) {
    const isLoaded = await loadScriptRunsOnce(drawnView!);
    if (!isLoaded) {
      box.checked = false;
      return;
    }
    await redrawStage!();
  }
  if (kind === ShowRowKind.branch && box.checked && !hasLoadedBranches(drawnView!)) {
    const isLoaded = await loadBranchesOnce(drawnView!);
    if (!isLoaded) {
      box.checked = false;
      return;
    }
    await redrawStage!();
  }
  if (box.checked) {
    hiddenKinds.delete(kind);
  }
  else {
    hiddenKinds.add(kind);
  }
  applyHiddenKindsAttribute();
  notifyKindBoxToggle();
  // Edit, script run and branch start hidden on every load, so they are never saved.
  saveHiddenKinds([...hiddenKinds].filter((hidden) => hidden !== ShowRowKind.edit && hidden !== ShowRowKind.scriptRun && hidden !== ShowRowKind.branch));
  notifyKindFilterChange();
}

function handleKindToggle(event: Event): Promise<void> {
  return toggleKindBox(event.target as HTMLInputElement);
}

function findKindBox(kind: ShowRowKind): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#show-row input[data-kind="${kind}"]`)!;
}

// The [3] button clicks the Edit box, so both share one code path.
function tickEditBox(): void {
  const box = findKindBox(ShowRowKind.edit);
  if (!box.checked) {
    box.click();
  }
}

// Spec S21.9: [4] implies [3]. The loads run one after the other: they share one busy shield.
async function tickEditAndScriptRunBoxes(): Promise<void> {
  for (const kind of [ShowRowKind.edit, ShowRowKind.scriptRun]) {
    const box = findKindBox(kind);
    if (!box.checked) {
      box.checked = true;
      await toggleKindBox(box);
    }
    if (!box.checked) {
      return;
    }
  }
}

export function renderShowRowWithKindFilter(view: WireLayer1View, redrawView: () => void | Promise<void>): void {
  drawnView = view;
  redrawStage = redrawView;
  renderShowRow(view);
  const saved = getHiddenKindsForProject(getInputById("dir").value.trim());
  hiddenKinds = new Set(Object.values(ShowRowKind).filter((kind) => saved.includes(kind)));
  hiddenKinds.add(ShowRowKind.edit);
  hiddenKinds.add(ShowRowKind.scriptRun);
  hiddenKinds.add(ShowRowKind.branch);
  for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
    box.checked = !hiddenKinds.has(box.dataset["kind"] as ShowRowKind);
  }
  applyHiddenKindsAttribute();
  // Assigned, not added, so a re-render never stacks listeners.
  getRequiredElementById("show-row").onchange = handleKindToggle;
  getRequiredElementById("layer-3").onclick = tickEditBox;
  getRequiredElementById("layer-4").onclick = tickEditAndScriptRunBoxes;
}

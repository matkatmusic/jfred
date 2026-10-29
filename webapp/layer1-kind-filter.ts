// Task 360: the show row's checkboxes hide node kinds by CSS attribute; no relayout, no refetch.

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { isBranchesLoaded, loadBranchesOnce } from "./layer1-branches.ts";
import { isEditsLoaded, loadEditsOnce } from "./layer1-edits.ts";
import { attachKindButtons } from "./layer1-kind-buttons.ts";
import { isScriptRunsLoaded, loadScriptRunsOnce } from "./layer1-script-runs.ts";
import { LAYER1_PROGRESS_LABEL_DRAWING_EDITS, hideLayer1Progress, renderLayer1Progress, waitForPaintedFrame } from "./layer1-progress.ts";
import { getHiddenKindsForProject, saveHiddenKinds } from "./layer1-settings.ts";
import { ShowRowKind, renderShowRow } from "./layer1-show-row.ts";
import type { WireLayer1View } from "./layer1-wire.ts";

export const KIND_HIDDEN_CLASS = "kind-hidden";

// The HIDDEN kinds, not the shown ones, so a kind that appears later defaults to visible.
let hiddenKinds = new Set<ShowRowKind>();

// Registered by layer1-tick-files.ts so the ruler follows the boxes without an import cycle.
let notifyKindFilterChange: () => void = () => {};

export function registerKindFilterChange(callback: () => void): void {
  notifyKindFilterChange = callback;
}

// Registered by layer1-kind-jump.ts so its arrows follow the boxes without an import cycle.
let notifyKindBoxToggle: () => void = () => {};

export function registerKindBoxToggle(callback: () => void): void {
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

export async function toggleKindBox(box: HTMLInputElement): Promise<void> {
  let kind!: ShowRowKind;
  for (const candidate of Object.values(ShowRowKind)) {
    const isBoxKind = candidate === box.dataset["kind"];
    if (isBoxKind) {
      kind = candidate;
      break;
    }
  }
  const isEditBoxTurningOn = kind === ShowRowKind.edit && box.checked;
  const needsEditLoad = isEditBoxTurningOn && !isEditsLoaded(drawnView!);
  if (needsEditLoad) {
    const isLoaded = await loadEditsOnce(drawnView!);
    if (!isLoaded) {
      box.checked = false;
      return;
    }
    // The kind shows before the redraw so edit nodes appear as drawn; the bar stays up.
    renderLayer1Progress(LAYER1_PROGRESS_LABEL_DRAWING_EDITS);
    await waitForPaintedFrame();
    hiddenKinds.delete(kind);
    applyHiddenKindsAttribute();
    await redrawStage!();
    hideLayer1Progress();
    return;
  }
  const isScriptRunBoxTurningOn = kind === ShowRowKind.scriptRun && box.checked;
  const needsScriptRunLoad = isScriptRunBoxTurningOn && !isScriptRunsLoaded(drawnView!);
  if (needsScriptRunLoad) {
    const isLoaded = await loadScriptRunsOnce(drawnView!);
    if (!isLoaded) {
      box.checked = false;
      return;
    }
    await redrawStage!();
  }
  const isBranchBoxTurningOn = kind === ShowRowKind.branch && box.checked;
  const needsBranchLoad = isBranchBoxTurningOn && !isBranchesLoaded(drawnView!);
  if (needsBranchLoad) {
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
  const savedKinds: ShowRowKind[] = [];
  for (const hidden of hiddenKinds) {
    const isStartHiddenKind = hidden === ShowRowKind.edit || hidden === ShowRowKind.scriptRun || hidden === ShowRowKind.branch;
    if (!isStartHiddenKind) {
      savedKinds.push(hidden);
    }
  }
  saveHiddenKinds(savedKinds);
  notifyKindFilterChange();
}

function toggleKindBoxFromEvent(event: Event): Promise<void> {
  return toggleKindBox(event.target as HTMLInputElement);
}

export function renderShowRowWithKindFilter(view: WireLayer1View, redrawView: () => void | Promise<void>): void {
  drawnView = view;
  redrawStage = redrawView;
  renderShowRow(view);
  const saved = getHiddenKindsForProject(getInputById("dir").value.trim());
  hiddenKinds = new Set<ShowRowKind>();
  for (const kind of Object.values(ShowRowKind)) {
    const isSavedHidden = saved.includes(kind);
    if (isSavedHidden) {
      hiddenKinds.add(kind);
    }
  }
  hiddenKinds.add(ShowRowKind.edit);
  hiddenKinds.add(ShowRowKind.scriptRun);
  hiddenKinds.add(ShowRowKind.branch);
  for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
    box.checked = !hiddenKinds.has(box.dataset["kind"] as ShowRowKind);
  }
  applyHiddenKindsAttribute();
  // Assigned, not added, so a re-render never stacks listeners.
  getRequiredElementById("show-row").onchange = toggleKindBoxFromEvent;
  attachKindButtons();
}

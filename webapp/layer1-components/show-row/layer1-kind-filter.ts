// Task 360: the show row's checkboxes hide node kinds by CSS attribute; no relayout, no refetch.

import { getInputById, getRequiredElementById } from "../../app-dom.ts";
import { isBranchesLoaded, loadBranchesOnce } from "../bubbles/layer1-branches.ts";
import { isEditsLoaded, loadEditsOnce } from "../../layer1-edits.ts";
import { attachKindButtons } from "./layer1-kind-buttons.ts";
import { isScriptRunsLoaded, loadScriptRunsOnce } from "../../layer1-script-runs.ts";
import { LAYER1_PROGRESS_LABEL_DRAWING_EDITS, hideLayer1Progress, renderLayer1Progress, waitForPaintedFrame } from "../loading-bar/layer1-progress.ts";
import { getHiddenKindsForProject, saveHiddenKinds } from "../../layer1-settings.ts";
import { ShowRowKind, renderShowRow } from "./layer1-show-row.ts";
import type { WireLayer1View } from "../../layer1-wire.ts";

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

// The run queue and the run route redraw through the same function the Show row uses.
export async function refreshDrawnStage(): Promise<void> {
  await redrawStage!();
}

function findBoxKind(box: HTMLInputElement): ShowRowKind {
  let kind!: ShowRowKind;
  for (const candidate of Object.values(ShowRowKind)) {
    const isBoxKind = candidate === box.dataset["kind"];
    if (isBoxKind) {
      kind = candidate;
      break;
    }
  }
  return kind;
}

function isKindLoadNeeded(box: HTMLInputElement, kind: ShowRowKind, loadingKind: ShowRowKind, isLoaded: boolean): boolean {
  const isBoxTurningOn = kind === loadingKind && box.checked;
  return isBoxTurningOn && !isLoaded;
}

// The kind shows before the redraw so edit nodes appear as drawn; the bar stays up.
async function renderEditsAfterLoad(box: HTMLInputElement, kind: ShowRowKind): Promise<void> {
  const isLoaded = await loadEditsOnce(drawnView!);
  if (!isLoaded) {
    box.checked = false;
    return;
  }
  renderLayer1Progress(LAYER1_PROGRESS_LABEL_DRAWING_EDITS);
  await waitForPaintedFrame();
  hiddenKinds.delete(kind);
  applyHiddenKindsAttribute();
  await redrawStage!();
  hideLayer1Progress();
}

// False when the load failed and the box was unchecked.
async function loadViewThenRedraw(box: HTMLInputElement, loadOnce: (view: WireLayer1View) => Promise<boolean>): Promise<boolean> {
  const isLoaded = await loadOnce(drawnView!);
  if (!isLoaded) {
    box.checked = false;
    return false;
  }
  await redrawStage!();
  return true;
}

async function loadScriptRunsIfNeeded(box: HTMLInputElement, kind: ShowRowKind): Promise<boolean> {
  const needsLoad = isKindLoadNeeded(box, kind, ShowRowKind.scriptRun, isScriptRunsLoaded(drawnView!));
  if (!needsLoad) {
    return true;
  }
  return loadViewThenRedraw(box, loadScriptRunsOnce);
}

async function loadBranchesIfNeeded(box: HTMLInputElement, kind: ShowRowKind): Promise<boolean> {
  const needsLoad = isKindLoadNeeded(box, kind, ShowRowKind.branch, isBranchesLoaded(drawnView!));
  if (!needsLoad) {
    return true;
  }
  return loadViewThenRedraw(box, loadBranchesOnce);
}

// A box that needs no load toggles in the same tick, with no await.
function isViewLoadNeeded(box: HTMLInputElement, kind: ShowRowKind): boolean {
  const needsScriptRunLoad = isKindLoadNeeded(box, kind, ShowRowKind.scriptRun, isScriptRunsLoaded(drawnView!));
  if (needsScriptRunLoad) {
    return true;
  }
  return isKindLoadNeeded(box, kind, ShowRowKind.branch, isBranchesLoaded(drawnView!));
}

// False when a load failed and the box was unchecked.
async function loadScriptRunsAndBranchesIfNeeded(box: HTMLInputElement, kind: ShowRowKind): Promise<boolean> {
  const isScriptRunsReady = await loadScriptRunsIfNeeded(box, kind);
  if (!isScriptRunsReady) {
    return false;
  }
  return loadBranchesIfNeeded(box, kind);
}

// Edit, script run and branch start hidden on every load, so they are never saved.
function saveShownKindSettings(): void {
  const savedKinds: ShowRowKind[] = [];
  for (const hidden of hiddenKinds) {
    const isStartHiddenKind = hidden === ShowRowKind.edit || hidden === ShowRowKind.scriptRun || hidden === ShowRowKind.branch;
    if (!isStartHiddenKind) {
      savedKinds.push(hidden);
    }
  }
  saveHiddenKinds(savedKinds);
}

function applyKindToggle(box: HTMLInputElement, kind: ShowRowKind): void {
  if (box.checked) {
    hiddenKinds.delete(kind);
  }
  else {
    hiddenKinds.add(kind);
  }
  applyHiddenKindsAttribute();
  notifyKindBoxToggle();
  saveShownKindSettings();
  notifyKindFilterChange();
}

async function applyKindToggleAfterLoad(box: HTMLInputElement, kind: ShowRowKind): Promise<void> {
  const isViewsReady = await loadScriptRunsAndBranchesIfNeeded(box, kind);
  if (isViewsReady) {
    applyKindToggle(box, kind);
  }
}

export async function toggleKindBox(box: HTMLInputElement): Promise<void> {
  const kind = findBoxKind(box);
  const needsEditLoad = isKindLoadNeeded(box, kind, ShowRowKind.edit, isEditsLoaded(drawnView!));
  if (needsEditLoad) {
    await renderEditsAfterLoad(box, kind);
    return;
  }
  const needsViewLoad = isViewLoadNeeded(box, kind);
  if (needsViewLoad) {
    await applyKindToggleAfterLoad(box, kind);
    return;
  }
  applyKindToggle(box, kind);
}

function toggleKindBoxFromEvent(event: Event): Promise<void> {
  return toggleKindBox(event.target as HTMLInputElement);
}

function updateKindBoxChecks(): void {
  for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
    box.checked = !hiddenKinds.has(box.dataset["kind"] as ShowRowKind);
  }
}

function resetHiddenKindsFromSettings(): void {
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
  updateKindBoxChecks();
  applyHiddenKindsAttribute();
}

export function renderShowRowWithKindFilter(view: WireLayer1View, redrawView: () => void | Promise<void>): void {
  drawnView = view;
  redrawStage = redrawView;
  renderShowRow(view);
  resetHiddenKindsFromSettings();
  // Assigned, not added, so a re-render never stacks listeners.
  getRequiredElementById("show-row").onchange = toggleKindBoxFromEvent;
  attachKindButtons();
}

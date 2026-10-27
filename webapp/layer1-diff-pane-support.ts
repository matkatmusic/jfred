// Pure and DOM-edge helpers split out of the diff pane controller.

import { createElement, getRequiredElementById } from "./app-dom.ts";
import type { DiffPaneModeValue, DiffStep } from "./layer1-diff-pane.ts";

// The pane's mounted elements: the drawer passes its fixed-id rows, a multi section its own.
export type DiffPaneMounts = {
  pairLabel: HTMLElement;
  meta: HTMLElement;
  body: HTMLElement;
  modeButtons: HTMLElement[];
  fullToggle: HTMLInputElement;
  exportButton: HTMLElement;
  // The whole mode/full/export row, hidden while equal sides show one revision instead of a diff.
  toolsRow?: HTMLElement;
  // base ↑, base ↓, target ↑, target ↓ — older is up, matching the lane's axis.
  arrows: [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
};

export type DiffPaneOptions = {
  mode: DiffPaneModeValue;
  fullContents: boolean;
  onSidesChanged?: (baseIndex: number, targetIndex: number) => void;
};

export type DiffPane = {
  showPair(path: string, steps: DiffStep[], baseIndex: number, targetIndex: number): Promise<void>;
  clear(): void;
};

const TOAST_MILLISECONDS = 2600;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function hideToast(): void {
  getRequiredElementById("dtoast").hidden = true;
}

// The refusal is VISIBLE, never a silent no-op (task 305). One #dtoast serves every pane.
export function openToast(text: string): void {
  const toast = getRequiredElementById("dtoast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MILLISECONDS);
}

// Equal sides are one revision: the label names it once, meta is empty.
export function buildPairText(baseMarker: string, targetMarker: string, isSameRevision: boolean): { label: string; meta: string } {
  if (isSameRevision) {
    return { label: targetMarker, meta: "" };
  }
  return { label: `${baseMarker} - ${targetMarker}`, meta: `base ${baseMarker} → target ${targetMarker}` };
}

// Order: base up, base down, target up, target down; true when the step leaves the list.
export function computeArrowDisabledFlags(baseIndex: number, targetIndex: number, stepCount: number): boolean[] {
  const flags: boolean[] = [];
  for (let at = 0; at < 4; at++) {
    const sideIndex = at < 2 ? baseIndex : targetIndex;
    const landing = sideIndex + (at % 2 === 0 ? -1 : 1);
    flags.push(landing < 0 || landing > stepCount - 1);
  }
  return flags;
}

export function fetchDiffContent(base: string, target: string, isFullContext: boolean): Promise<Response> {
  return fetch("/api/layer1-diff-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base, target, context: isFullContext ? "full" : undefined }),
  });
}

// Headers + hunks make one git-apply-able file patch (task 218's shape).
export function buildPatchText(path: string, diffText: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${diffText}\n`;
}

export function savePatchFile(path: string, patchText: string): void {
  const link = createElement("a") as HTMLAnchorElement;
  link.href = URL.createObjectURL(new Blob([patchText], { type: "text/x-patch" }));
  link.download = `${path.split("/").pop()}.patch`;
  link.click();
  URL.revokeObjectURL(link.href);
}

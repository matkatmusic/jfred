// Details pane choices persisted in localStorage: the Columns/Inline diff toggle and Show full contents.

import {
  DIFF_MODE_STORAGE_KEY,
  DiffDisplayMode,
  computeInitialDiffDisplayMode,
} from "../diff-display-mode.ts";

// The two diff-toggle labels (#dm-columns / #dm-inline).
export type DiffToggleLabel = "columns" | "inline";

// Stored "split" or garbage reads Columns, "inline" reads Inline: one storage key, two vocabularies.
export function convertStoredDiffModeToToggle(stored: string | undefined): DiffToggleLabel {
  const storedMode = computeInitialDiffDisplayMode(stored);
  if (storedMode === DiffDisplayMode.split) {
    return "columns";
  }
  return "inline";
}

// localStorage is browser-only; the node test runner has no DOM (item 36a).
export function readStoredDiffMode(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return localStorage.getItem(DIFF_MODE_STORAGE_KEY) ?? undefined;
}

export function writeStoredDiffMode(label: DiffToggleLabel): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(DIFF_MODE_STORAGE_KEY, label === "columns" ? DiffDisplayMode.split : DiffDisplayMode.inline);
}

// item 75: "Show full contents" persists like the Columns/Inline toggle, under its own key.
const FULL_CONTENTS_STORAGE_KEY = "reveng.diff.fullContents";

// "1" is on; absent or anything else is off.
export function computeInitialFullContentsChoice(stored: string | undefined): boolean {
  return stored === "1";
}

function readStoredFullContents(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return localStorage.getItem(FULL_CONTENTS_STORAGE_KEY) ?? undefined;
}

export function writeStoredFullContents(on: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(FULL_CONTENTS_STORAGE_KEY, on ? "1" : "0");
}

export function isFullContentsOn(): boolean {
  return computeInitialFullContentsChoice(readStoredFullContents());
}

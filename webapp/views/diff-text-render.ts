// Renders unified diff text into a pane as an inline or split grid, with a persisted mode toggle.

import { createElement } from "../app-dom.ts";
import { computeSplitRows, SplitRowKind } from "../diff-vs-base-model.ts";
import { computeInlineRows } from "../diff-inline-rows.ts";
import {
  DIFF_MODE_STORAGE_KEY,
  DiffDisplayMode,
  computeInitialDiffDisplayMode,
  type DiffDisplayModeValue,
} from "../diff-display-mode.ts";

// Guarded on `window`: touching `localStorage` at all warns on Node 26 (item 36a).
function readStoredDiffMode(): string | null | undefined {
  // if (typeof localStorage === "undefined") {  // item 36a: typeof localStorage itself warns
  if (typeof window === "undefined") {
    return undefined;
  }
  return localStorage.getItem(DIFF_MODE_STORAGE_KEY);
}

function writeStoredDiffMode(mode: DiffDisplayModeValue): void {
  // if (typeof localStorage === "undefined") {  // item 36a: typeof localStorage itself warns
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(DIFF_MODE_STORAGE_KEY, mode);
}

let diffDisplayMode = computeInitialDiffDisplayMode(readStoredDiffMode());

// Inline grid: old number, new number, raw line (items 39, 40); hunk headers span all columns (item 36c).
function renderInlineDiffLines(pane: HTMLElement, diffText: string): void {
  // item 40: the un-numbered per-line divs, replaced by the numbered grid below.
  // for (const line of diffText.split("\n")) {
  //     pane.append(createElement("div", { class: computeFullRowLineClass(line), text: line }));
  // }
  const grid = createElement("div", { class: "diff-inline" });
  for (const row of computeInlineRows(diffText)) {
    if (row.lineClass === "diff-line-hunk") {
      grid.append(createElement("div", { class: `diff-full ${row.lineClass}`, text: row.text }));
      continue;
    }
    grid.append(
      createElement("div", { class: "diff-line-num", text: row.oldLineNumber === undefined ? "" : String(row.oldLineNumber) }),
      createElement("div", { class: "diff-line-num", text: row.newLineNumber === undefined ? "" : String(row.newLineNumber) }),
      createElement("div", { class: row.lineClass, text: row.text }),
    );
  }
  pane.append(grid);
}

// Split grid: four columns; empty divs keep the grid aligned when one side is absent.
function appendSplitCell(grid: HTMLElement, cell: { lineNumber?: number; lineClass: string; text: string } | undefined): void {
  if (cell === undefined) {
    grid.append(createElement("div", { class: "diff-line-num" }), createElement("div", {}));
    return;
  }
  grid.append(
    createElement("div", { class: "diff-line-num", text: cell.lineNumber === undefined ? "" : String(cell.lineNumber) }),
    createElement("div", { class: cell.lineClass, text: cell.text }),
  );
}

function renderSplitDiffGrid(pane: HTMLElement, diffText: string): void {
  const grid = createElement("div", { class: "diff-split" });
  for (const row of computeSplitRows(diffText)) {
    if (row.kind === SplitRowKind.full) {
      grid.append(createElement("div", { class: `diff-full ${row.lineClass}`.trim(), text: row.text }));
      continue;
    }
    for (const cell of [row.left, row.right]) {
      appendSplitCell(grid, cell);
    }
  }
  pane.append(grid);
}

export function renderDiffText(pane: HTMLElement, diffText: string): void {
  pane.replaceChildren();
  const toggleButton = createElement("button", {
    class: "row-btn",
    text: diffDisplayMode === DiffDisplayMode.split ? "inline view" : "side by side",
    onclick: () => {
      diffDisplayMode = diffDisplayMode === DiffDisplayMode.split ? DiffDisplayMode.inline : DiffDisplayMode.split;
      writeStoredDiffMode(diffDisplayMode);
      renderDiffText(pane, diffText);
    },
  });
  pane.append(createElement("div", { class: "diff-view-toggle" }, [toggleButton]));
  if (diffDisplayMode === DiffDisplayMode.inline) {
    renderInlineDiffLines(pane, diffText);
    return;
  }
  renderSplitDiffGrid(pane, diffText);
}

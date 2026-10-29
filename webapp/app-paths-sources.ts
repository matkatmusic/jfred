// The Paths popover's Sources list: a project can declare several conversation-log roots.

import { createElement } from "./app-dom.ts";

// Client-side copy of the server's WireSourceEntry.
export type WireSourceEntryClient = { projectsDir: string; fileHistoryDir?: string; root?: string };

function getSourcesList(): HTMLElement {
  return document.getElementById("project-sources-list")!;
}

function getRowInput(row: HTMLElement, className: string): HTMLInputElement {
  return row.querySelector(`.${className}`) as HTMLInputElement;
}

// One source row: three inputs (only projects dir required) plus a remove button.
function buildSourceRow(entry: WireSourceEntryClient): HTMLElement {
  const row = createElement("div", { class: "source-row" }, [
    createElement("input", { class: "source-projects-dir", placeholder: "projects dir", value: entry.projectsDir }),
    createElement("input", { class: "source-file-history-dir", placeholder: "file-history dir (optional)", value: entry.fileHistoryDir ?? "" }),
    createElement("input", { class: "source-root", placeholder: "workspace root (optional)", value: entry.root ?? "" }),
    createElement("button", { class: "source-remove", type: "button", text: "✕" }),
  ]);
  (row.querySelector(".source-remove") as HTMLButtonElement).onclick = () => row.remove();
  return row;
}

// Rebuild #project-sources-list from `sources`, one .source-row per entry (task 177).
export function renderSourceRows(sources: WireSourceEntryClient[]): void {
  const rows: HTMLElement[] = [];
  for (const source of sources) {
    rows.push(buildSourceRow(source));
  }
  getSourcesList().replaceChildren(...rows);
}

// "Add source": append one empty row without touching the existing rows.
function appendEmptySourceRow(): void {
  getSourcesList().append(buildSourceRow({ projectsDir: "" }));
}

// Bind the add button's click; onclick assignment keeps repeated calls from stacking handlers.
export function initSourcesSection(): void {
  (document.getElementById("project-sources-add") as HTMLButtonElement).onclick = appendEmptySourceRow;
}

// One row's fields, or undefined when its required projects-dir is empty (the row is dropped).
function collectSourceRow(row: HTMLElement): WireSourceEntryClient | undefined {
  const projectsDir = getRowInput(row, "source-projects-dir").value;
  if (projectsDir === "") {
    return undefined;
  }
  const entry: WireSourceEntryClient = { projectsDir };
  const fileHistoryDir = getRowInput(row, "source-file-history-dir").value;
  if (fileHistoryDir !== "") {
    entry.fileHistoryDir = fileHistoryDir;
  }
  const root = getRowInput(row, "source-root").value;
  if (root !== "") {
    entry.root = root;
  }
  return entry;
}

// Read rows with a projects dir in DOM order; undefined when none qualify.
export function collectSourceRows(): WireSourceEntryClient[] | undefined {
  const rows = getSourcesList().querySelectorAll<HTMLElement>(".source-row");
  const entries: WireSourceEntryClient[] = [];
  for (const row of rows) {
    const entry = collectSourceRow(row);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries.length === 0 ? undefined : entries;
}

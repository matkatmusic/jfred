// ─── the Paths popover's per-project Sources list (task 177): lets a project declare MULTIPLE conversation-log roots (each with its own optional file-history dir + workspace root), riding inside the existing #project-paths-section per the task-159 wizard constraint — stable ids now, the wizard redesign absorbs this later. ───

import { el } from "./app-dom.ts";

// One source entry on the wire (WireSourceEntry server-side) — the client-side copy, precedent: app-paths-project.ts declares its own WireProjectPathsEntry client copy.
export type WireSourceEntryClient = { projectsDir: string; fileHistoryDir?: string; root?: string };

function getSourcesList(): HTMLElement {
    return document.getElementById("project-sources-list")!;
}

function getRowInput(row: HTMLElement, className: string): HTMLInputElement {
    return row.querySelector(`.${className}`) as HTMLInputElement;
}

// One source row: three inputs (projects dir required, file-history dir + root optional) plus a remove button. onclick assignment (not addEventListener) — each row is freshly built, so there is no stacking risk, but it matches the file's convention.
function buildSourceRow(entry: WireSourceEntryClient): HTMLElement {
    const row = el("div", { class: "source-row" }, [
        el("input", { class: "source-projects-dir", placeholder: "projects dir", value: entry.projectsDir }),
        el("input", { class: "source-file-history-dir", placeholder: "file-history dir (optional)", value: entry.fileHistoryDir ?? "" }),
        el("input", { class: "source-root", placeholder: "workspace root (optional)", value: entry.root ?? "" }),
        el("button", { class: "source-remove", type: "button", text: "✕" }),
    ]);
    (row.querySelector(".source-remove") as HTMLButtonElement).onclick = () => row.remove();
    return row;
}

// Rebuild #project-sources-list from `sources`, one .source-row per entry (task 177).
export function renderSourceRows(sources: WireSourceEntryClient[]): void {
    getSourcesList().replaceChildren(...sources.map(buildSourceRow));
}

// "Add source": append one empty row without touching the existing rows.
function appendEmptySourceRow(): void {
    getSourcesList().append(buildSourceRow({ projectsDir: "" }));
}

// Bind #project-sources-add's click once per popover refresh. onclick assignment (not addEventListener) so repeated calls never stack handlers — safe to call on every refresh.
export function initializeSourcesSection(): void {
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

// Read every row in DOM order, keeping only rows with a non-empty projects-dir; undefined when no row qualifies so the POSTed entry omits `sources` entirely (legacy entries stay legacy).
export function collectSourceRows(): WireSourceEntryClient[] | undefined {
    const rows = [...getSourcesList().querySelectorAll(".source-row")] as HTMLElement[];
    const entries = rows.map(collectSourceRow).filter((entry): entry is WireSourceEntryClient => entry !== undefined);
    return entries.length === 0 ? undefined : entries;
}

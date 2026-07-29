// Diff-vs-Base view (#/project/<name>/file/<path>/vsbase): the file's first revision against a selected revision. Side-by-side/inline toggle, revision selector with URL sync, line-number gutters.

import { el as elFromApp } from "../app-dom.ts";
import { getBaselineChoice, getConsentChoice } from "../app-choices.ts";
import {
    fetchDocument,
    fetchText,
} from "../app-fetch.ts";
import { renderConsentDialog } from "../app-consent.ts";
import { renderBaselineQuestionDialog } from "../app-baseline-question.ts";
import { routeToFileHistory } from "../app-routes.ts";
import {
    computeInlineRows,
    computeSplitRows,
    DIFF_MODE_STORAGE_KEY,
    DiffDisplayMode,
    resolveInitialDiffDisplayMode,
    SplitRowKind,
    type DiffDisplayModeValue,
} from "../diff-vs-base-model.ts";
import { buildFileHistoryViewModel, computeAnchoredRevisionIndex, type WireDocument as WireFileHistoryDocument } from "./file-history-model.ts";

// app.ts is typed in parallel; a precise local signature for `el` until then.
const el = elFromApp as (
    tag: string,
    attrs?: Record<string, string | EventListener>,
    children?: readonly HTMLElement[],
) => HTMLElement;

// Minimal wire shape of the revisions this view reads off the file-history view model.
type WireRevisionSummary = { kind: string };

// localStorage access is guarded: the node test runner imports this module with no DOM. The guard checks `window`, not `localStorage` — on Node 26 even `typeof localStorage` (and a try/catch around it) fires the ExperimentalWarning, because touching the global getter at all is what warns (item 36a).
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

let diffDisplayMode = resolveInitialDiffDisplayMode(readStoredDiffMode());

// Inline view as a 3-column grid: old number | new number | raw unified line (item 40); the text column wraps instead of overflowing the pane (item 39). Hunk-header rows span all columns as muted "@@ -a,b +c,d @@" text, matching the split view (item 36c).
function renderInlineDiffLines(pane: HTMLElement, diffText: string): void {
    // item 40: the un-numbered per-line divs, replaced by the numbered grid below.
    // for (const line of diffText.split("\n")) {
    //     pane.append(el("div", { class: computeFullRowLineClass(line), text: line }));
    // }
    const grid = el("div", { class: "diff-inline" });
    for (const row of computeInlineRows(diffText)) {
        if (row.lineClass === "diff-line-hunk") {
            grid.append(el("div", { class: `diff-full ${row.lineClass}`, text: row.text }));
            continue;
        }
        grid.append(
            el("div", { class: "diff-line-num", text: row.oldLineNumber === undefined ? "" : String(row.oldLineNumber) }),
            el("div", { class: "diff-line-num", text: row.newLineNumber === undefined ? "" : String(row.newLineNumber) }),
            el("div", { class: row.lineClass, text: row.text }),
        );
    }
    pane.append(grid);
}

// The split grid: 4 columns (old number | old text | new number | new text). Full rows span all columns; pair rows emit a gutter + text cell per side (empty divs keep the grid aligned when one side is absent).
function appendSplitCell(grid: HTMLElement, cell: { lineNumber?: number; lineClass: string; text: string } | undefined): void {
    if (cell === undefined) {
        grid.append(el("div", { class: "diff-line-num" }), el("div", {}));
        return;
    }
    grid.append(
        el("div", { class: "diff-line-num", text: cell.lineNumber === undefined ? "" : String(cell.lineNumber) }),
        el("div", { class: cell.lineClass, text: cell.text }),
    );
}

function renderSplitDiffGrid(pane: HTMLElement, diffText: string): void {
    const grid = el("div", { class: "diff-split" });
    for (const row of computeSplitRows(diffText)) {
        if (row.kind === SplitRowKind.full) {
            grid.append(el("div", { class: `diff-full ${row.lineClass}`.trim(), text: row.text }));
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
    const toggleButton = el("button", {
        class: "row-btn",
        text: diffDisplayMode === DiffDisplayMode.split ? "inline view" : "side by side",
        onclick: () => {
            diffDisplayMode = diffDisplayMode === DiffDisplayMode.split ? DiffDisplayMode.inline : DiffDisplayMode.split;
            writeStoredDiffMode(diffDisplayMode);
            renderDiffText(pane, diffText);
        },
    });
    pane.append(el("div", { class: "diff-view-toggle" }, [toggleButton]));
    if (diffDisplayMode === DiffDisplayMode.inline) {
        renderInlineDiffLines(pane, diffText);
        return;
    }
    renderSplitDiffGrid(pane, diffText);
}

// anchorRev (optional): 1-based revision to preselect instead of the last one.
export async function renderDiffVsBaseView(
    container: HTMLElement,
    project: string,
    target: string,
    anchorRev: string | undefined,
): Promise<void> {
    const result = await fetchDocument<WireFileHistoryDocument>(project, undefined);
    if (result.baselineQuestion !== undefined) {
        renderBaselineQuestionDialog(container, project, result.baselineQuestion);
        return;
    }
    if (result.consentRequired !== undefined) {
        renderConsentDialog(container, project, result.consentRequired);
        return;
    }
    const viewModel = buildFileHistoryViewModel(result.document!, target);
    const lastIndex = Math.max(viewModel.revisions.length - 1, 0);

    const revisionSelect = el("select", {}) as HTMLSelectElement;
    viewModel.revisions.forEach((revision: WireRevisionSummary, index: number) => {
        revisionSelect.append(el("option", { value: String(index), text: `#${index + 1} · ${revision.kind}` }));
    });
    const anchoredRevisionIndex = computeAnchoredRevisionIndex(anchorRev, viewModel.revisions.length);
    revisionSelect.value = String(anchoredRevisionIndex ?? lastIndex);

    const diffPane = el("div", { class: "diff-text" });
    const loadDiff = async () => {
        const params = new URLSearchParams({ project, file: target, mode: "vsbase", rev: revisionSelect.value });
        if (getConsentChoice(project) === "1") params.set("allowScripts", "1");
        // task 56: ride the stored pre-baseline answer so this hits the same cached document.
        const baselineChoice = getBaselineChoice(project);
        if (baselineChoice !== null) params.set("preBaseline", baselineChoice);
        renderDiffText(diffPane, await fetchText(`/api/diff?${params}`));
    };
    // URL sync lives in the listener, not loadDiff, so the initial render never rewrites a bare /vsbase URL.
    revisionSelect.addEventListener("change", async () => {
        await loadDiff();
        history.replaceState(null, "", `${routeToFileHistory(project, target)}/vsbase/${Number(revisionSelect.value) + 1}`);
    });

    container.append(el("div", { class: "filter-bar" }, [
        el("div", { class: "pane-title", text: `${target} · vs base` }),
        el("span", { class: "muted", text: "base #1 →" }),
        revisionSelect,
        // task 93: the route now opens THE Revision View (the File History view is retired).
        el("a", { href: routeToFileHistory(project, target), text: "← file revisions" }),
    ]));
    container.append(diffPane);
    await loadDiff();
}

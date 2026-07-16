// Details pane right-column rendering (split from details.ts, task 92): the shared #details-*
// pane plumbing plus the text / content / diff renders. Diff rendering reuses diff-vs-base's
// row view-models with the mockup's .diff / .diff-cols markup; showTextInDetails,
// showContentInDetails, and showDiffInDetails live together because they share the module's
// shownDiff toggle state.

import { el } from "../app-dom.ts";
import { fetchText, getConsentChoice } from "../app-fetch.ts";
import {
    SplitRowKind,
    computeInlineRows,
    computeSplitRows,
} from "./diff-vs-base-model.ts";
import { findRevisionForChangeId, splitDiffBlocks } from "./file-history-model.ts";
import { computeRevisionDiffFallbackText } from "./timeline-labels.ts";
import { type FileChange } from "./timeline-types.ts";
import {
    type DiffToggleLabel,
    type WireFileHistory,
    fullContentsIsOn,
    mapStoredDiffModeToToggle,
    readStoredDiffMode,
    writeStoredDiffMode,
    writeStoredFullContents,
} from "./details-model.ts";
import { renderCodeInto } from "../highlight.ts";

// ── shared right-pane plumbing ──────────────────────────────────────────────────────────────

export function setDetailsHeader(text: string): void {
    document.getElementById("details-header")!.textContent = text;
}

export function setRightPaneLabel(text: string): void {
    document.getElementById("details-right-label")!.textContent = text;
}

export function hideDiffModeToggle(): void {
    document.getElementById("diff-mode-toggle")!.hidden = true;
}

export function clearRightPaneBody(): HTMLElement {
    const body = document.getElementById("details-right-body")!;
    body.replaceChildren();
    return body;
}

// The diff the right pane currently shows, kept for toggle re-renders. `reload` re-fetches
// (a full-context diff is a DIFFERENT server response, so the full-contents toggle cannot
// re-render from the current text — item 75).
let shownDiff: { label: string; diffText: string; reload: () => void } | undefined;

// Plain explanatory text in the right pane (rename-only revisions, missing blocks).
export function showTextInDetails(label: string, text: string): void {
    shownDiff = undefined;
    setRightPaneLabel(label);
    hideDiffModeToggle();
    clearRightPaneBody().append(el("pre", { class: "diff-text", text }));
}

// The revision's full content in the right pane, syntax-highlighted (file-mode "Show content").
export function showContentInDetails(target: string, revisionNumber: number, content: string | undefined): void {
    shownDiff = undefined;
    setRightPaneLabel(`${target} — revision #${revisionNumber} content`);
    hideDiffModeToggle();
    const pane = el("pre", { class: "inspector-text" });
    if (content === undefined) {
        pane.textContent = "(no step snapshot carries this file yet)";
    } else {
        renderCodeInto(pane, content, target);
    }
    clearRightPaneBody().append(pane);
}

// The mockup's inline diff: one .diff-line per unified line, gutter number + raw text.
// Numbers come from diff-vs-base's computeInlineRows (dels count the old side, everything
// else the new side; hunk headers show ⋯).
function appendInlineDiff(body: HTMLElement, diffText: string): void {
    const pane = el("div", { class: "diff" });
    for (const row of computeInlineRows(diffText)) {
        const line = el("div", { class: "diff-line" });
        let lineNumberText: number | undefined;
        if (row.lineClass === "diff-line-hunk") {
            line.classList.add("hunk");
        } else if (row.lineClass === "diff-line-add") {
            line.classList.add("add");
            lineNumberText = row.newLineNumber;
        } else if (row.lineClass === "diff-line-del") {
            line.classList.add("del");
            lineNumberText = row.oldLineNumber;
        } else {
            lineNumberText = row.newLineNumber;
        }
        const gutterText = row.lineClass === "diff-line-hunk" ? "⋯" : lineNumberText === undefined ? "" : String(lineNumberText);
        line.append(
            el("span", { class: "diff-ln", text: gutterText }),
            el("span", { class: "diff-body", text: row.text }),
        );
        pane.append(line);
    }
    body.append(pane);
}

// A split cell's mockup class: dc-del / dc-add / plain context.
function mapSplitCellClass(lineClass: string): string {
    if (lineClass === "diff-line-del") {
        return "dc-del";
    }
    if (lineClass === "diff-line-add") {
        return "dc-add";
    }
    return "";
}

// The mockup's two-column diff grid, driven by diff-vs-base's computeSplitRows: full rows span
// the grid as hunk headers; pair rows emit ln+body cells per side (empty cells keep alignment).
// Exported for the script-run mode's stacked per-file diffs (task 67).
export function appendColumnsDiff(body: HTMLElement, diffText: string): void {
    const grid = el("div", { class: "diff-cols" });
    for (const row of computeSplitRows(diffText)) {
        if (row.kind === SplitRowKind.full) {
            grid.append(el("span", { class: "dc-hunk", text: row.text }));
            continue;
        }
        [row.left, row.right].forEach((cell, side) => {
            const sideClass = side === 1 ? " dc-right" : "";
            if (cell === undefined) {
                grid.append(
                    el("span", { class: `dc-ln${sideClass}` }),
                    el("span", { class: "dc-body" }),
                );
                return;
            }
            const cellClass = mapSplitCellClass(cell.lineClass);
            grid.append(
                el("span", { class: `dc-ln${sideClass} ${cellClass}`.trim(), text: cell.lineNumber === undefined ? "" : String(cell.lineNumber) }),
                el("span", { class: `dc-body ${cellClass}`.trim(), text: cell.text }),
            );
        });
    }
    body.append(grid);
}

// One diff in the right pane, in whichever layout the persisted toggle selects. #dm-columns /
// #dm-inline re-render the SAME diff and persist through diff-vs-base's storage vocabulary.
export function showDiffInDetails(label: string, diffText: string, reload: () => void): void {
    shownDiff = { label, diffText, reload };
    setRightPaneLabel(label);
    const mode = mapStoredDiffModeToToggle(readStoredDiffMode());
    const toggle = document.getElementById("diff-mode-toggle")!;
    toggle.hidden = false;
    const fullButton = document.getElementById("dm-full")!;
    const columnsButton = document.getElementById("dm-columns")!;
    const inlineButton = document.getElementById("dm-inline")!;
    fullButton.classList.toggle("active", fullContentsIsOn());
    columnsButton.classList.toggle("active", mode === "columns");
    inlineButton.classList.toggle("active", mode === "inline");
    const switchDiffMode = (label2: DiffToggleLabel) => {
        writeStoredDiffMode(label2);
        if (shownDiff !== undefined) {
            showDiffInDetails(shownDiff.label, shownDiff.diffText, shownDiff.reload);
        }
    };
    // Full contents changes the fetched diff (wider git context), so it re-fetches via
    // reload rather than re-rendering the current text.
    fullButton.onclick = () => {
        writeStoredFullContents(!fullContentsIsOn());
        reload();
    };
    columnsButton.onclick = () => switchDiffMode("columns");
    inlineButton.onclick = () => switchDiffMode("inline");
    const body = clearRightPaneBody();
    if (mode === "columns") {
        appendColumnsDiff(body, diffText);
        return;
    }
    appendInlineDiff(body, diffText);
}

// The revision-timeline diff blocks of one file, freshly fetched (same /api/diff request the
// file-history view issues, consent flag included).
export async function fetchRevisionDiffBlocks(project: string, target: string, fullContents: boolean): Promise<string[]> {
    const params = new URLSearchParams({ project, file: target, mode: "revisions" });
    if (getConsentChoice(project) === "1") {
        params.set("allowScripts", "1");
    }
    if (fullContents) {
        params.set("context", "full");
    }
    return splitDiffBlocks(await fetchText(`/api/diff?${params}`));
}

// One file change's revision diff in the right pane: its changeId resolves to a 1-based
// revision through the document's histories, that revision's block renders as a diff, and the
// no-hunk cases (renames, missing blocks) render their fallback explanation instead.
export async function showRevisionDiffInDetails(change: FileChange, blocks: string[], filesTouched: WireFileHistory[], reload: () => void): Promise<void> {
    const link = change.changeId === undefined ? undefined : findRevisionForChangeId(filesTouched, change.changeId, undefined);
    const block = link?.revisionNumber === undefined ? undefined : blocks[link.revisionNumber - 1];
    const fallbackText = computeRevisionDiffFallbackText(block, change);
    if (fallbackText !== undefined) {
        showTextInDetails(change.path, fallbackText);
        return;
    }
    showDiffInDetails(change.path, block!, reload);
}

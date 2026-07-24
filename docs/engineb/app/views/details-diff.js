// Details pane right-column rendering (split from details.ts, task 92): the shared #details-*
// pane plumbing plus the text / content / diff renders. Diff rendering reuses diff-vs-base's
// row view-models with the mockup's .diff / .diff-cols markup; showTextInDetails,
// showContentInDetails, and showDiffInDetails live together because they share the module's
// shownDiff toggle state.
import { el } from "../app-dom.js";
import { getBaselineChoice, getConsentChoice } from "../app-choices.js";
import { fetchText } from "../app-fetch.js";
import { resetDetailsFind } from "./details-find.js";
import { SplitRowKind, computeInlineRows, computeSplitRows } from "./diff-vs-base-model.js";
import { findRevisionForChangeId, splitDiffBlocks } from "./file-history-model.js";
import { computeRevisionDiffFallbackText } from "./timeline-labels.js";
import { fullContentsIsOn, mapStoredDiffModeToToggle, readStoredDiffMode, writeStoredDiffMode, writeStoredFullContents, } from "./details-model.js";
import { renderCodeInto } from "../highlight.js";
// ── shared right-pane plumbing ──────────────────────────────────────────────────────────────
export function setDetailsHeader(text) {
    document.getElementById("details-header").textContent = text;
}
export function setRightPaneLabel(text) {
    document.getElementById("details-right-label").textContent = text;
}
export function hideDiffModeToggle() {
    document.getElementById("diff-mode-toggle").hidden = true;
}
export function clearRightPaneBody() {
    // Every right-pane render routes through here, so stale find-widget Ranges never survive
    // a re-render (task 127).
    resetDetailsFind();
    const body = document.getElementById("details-right-body");
    body.replaceChildren();
    return body;
}
// The diff the right pane currently shows, kept for toggle re-renders. `reload` re-fetches
// (a full-context diff is a DIFFERENT server response, so the full-contents toggle cannot
// re-render from the current text — item 75).
let shownDiff;
// Plain explanatory text in the right pane (rename-only revisions, missing blocks).
export function showTextInDetails(label, text) {
    shownDiff = undefined;
    setRightPaneLabel(label);
    hideDiffModeToggle();
    clearRightPaneBody().append(el("pre", { class: "diff-text", text }));
}
// The revision's full content in the right pane, syntax-highlighted (file-mode "Show content").
export function showContentInDetails(target, revisionNumber, content) {
    shownDiff = undefined;
    setRightPaneLabel(`${target} — revision #${revisionNumber} content`);
    hideDiffModeToggle();
    const pane = el("pre", { class: "inspector-text" });
    if (content === undefined) {
        pane.textContent = "(no step snapshot carries this file yet)";
    }
    else {
        renderCodeInto(pane, content, target);
    }
    clearRightPaneBody().append(pane);
}
// task 126: the placeholder's banner stack — the timeline header's ⚠ banner styling
// (.recon-banner), the carried-forward note, and the section title above the previous
// revision's diff.
function appendUnrecoverableBanner(body, reason) {
    body.append(el("div", { class: "recon-banner" }, [
        el("span", { class: "warn", text: "⚠ Not reconstructed" }),
        ` — ${reason}`,
    ]), el("pre", { class: "diff-text", text: "(the previous revision's content is carried forward at this revision)" }), el("div", { class: "pane-title", text: "— previous revision content —" }));
}
// task 126: an unrecoverable placeholder's pane — the ⚠ banner, then the PREVIOUS revision's
// own diff (what the placeholder carries forward). The reason rides shownDiff so the
// columns/inline toggle re-renders keep the banner.
export function showUnrecoverableInDetails(label, reason, previousDiffText, reload) {
    if (previousDiffText === undefined) {
        shownDiff = undefined;
        setRightPaneLabel(label);
        hideDiffModeToggle();
        const body = clearRightPaneBody();
        appendUnrecoverableBanner(body, reason);
        body.append(el("pre", { class: "diff-text", text: "(no previous revision to show — this is the first revision)" }));
        return;
    }
    showDiffInDetails(label, previousDiffText, reload, reason);
}
// The mockup's inline diff: one .diff-line per unified line, gutter number + raw text.
// Numbers come from diff-vs-base's computeInlineRows (dels count the old side, everything
// else the new side; hunk headers show ⋯).
function appendInlineDiff(body, diffText) {
    const pane = el("div", { class: "diff" });
    for (const row of computeInlineRows(diffText)) {
        const line = el("div", { class: "diff-line" });
        let lineNumberText;
        if (row.lineClass === "diff-line-hunk") {
            line.classList.add("hunk");
        }
        else if (row.lineClass === "diff-line-add") {
            line.classList.add("add");
            lineNumberText = row.newLineNumber;
        }
        else if (row.lineClass === "diff-line-del") {
            line.classList.add("del");
            lineNumberText = row.oldLineNumber;
        }
        else {
            lineNumberText = row.newLineNumber;
        }
        const gutterText = row.lineClass === "diff-line-hunk" ? "⋯" : lineNumberText === undefined ? "" : String(lineNumberText);
        line.append(el("span", { class: "diff-ln", text: gutterText }), el("span", { class: "diff-body", text: row.text }));
        pane.append(line);
    }
    body.append(pane);
}
// A split cell's mockup class: dc-del / dc-add / plain context.
function mapSplitCellClass(lineClass) {
    if (lineClass === "diff-line-del") {
        return "dc-del";
    }
    if (lineClass === "diff-line-add") {
        return "dc-add";
    }
    return "";
}
// One side's ln+body cell pair in the two-column grid (empty cells keep alignment).
function appendSplitCellPair(grid, cell, side) {
    const sideClass = side === 1 ? " dc-right" : "";
    if (cell === undefined) {
        grid.append(el("span", { class: `dc-ln${sideClass}` }), el("span", { class: "dc-body" }));
        return;
    }
    const cellClass = mapSplitCellClass(cell.lineClass);
    grid.append(el("span", { class: `dc-ln${sideClass} ${cellClass}`.trim(), text: cell.lineNumber === undefined ? "" : String(cell.lineNumber) }), el("span", { class: `dc-body ${cellClass}`.trim(), text: cell.text }));
}
// The mockup's two-column diff grid, driven by diff-vs-base's computeSplitRows: full rows span
// the grid as hunk headers; pair rows emit ln+body cells per side (empty cells keep alignment).
// Exported for the script-run mode's stacked per-file diffs (task 67).
export function appendColumnsDiff(body, diffText) {
    const grid = el("div", { class: "diff-cols" });
    for (const row of computeSplitRows(diffText)) {
        if (row.kind === SplitRowKind.full) {
            grid.append(el("span", { class: "dc-hunk", text: row.text }));
            continue;
        }
        [row.left, row.right].forEach((cell, side) => {
            appendSplitCellPair(grid, cell, side);
        });
    }
    body.append(grid);
}
// One diff in the right pane, in whichever layout the persisted toggle selects. #dm-columns /
// #dm-inline re-render the SAME diff and persist through diff-vs-base's storage vocabulary.
export function showDiffInDetails(label, diffText, reload, unrecoverableReason) {
    shownDiff = { label, diffText, reload, unrecoverableReason };
    setRightPaneLabel(label);
    const mode = mapStoredDiffModeToToggle(readStoredDiffMode());
    const toggle = document.getElementById("diff-mode-toggle");
    toggle.hidden = false;
    const fullButton = document.getElementById("dm-full");
    const columnsButton = document.getElementById("dm-columns");
    const inlineButton = document.getElementById("dm-inline");
    fullButton.classList.toggle("active", fullContentsIsOn());
    columnsButton.classList.toggle("active", mode === "columns");
    inlineButton.classList.toggle("active", mode === "inline");
    const switchDiffMode = (label2) => {
        writeStoredDiffMode(label2);
        if (shownDiff !== undefined) {
            showDiffInDetails(shownDiff.label, shownDiff.diffText, shownDiff.reload, shownDiff.unrecoverableReason);
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
    if (unrecoverableReason !== undefined) {
        appendUnrecoverableBanner(body, unrecoverableReason);
    }
    if (mode === "columns") {
        appendColumnsDiff(body, diffText);
        return;
    }
    appendInlineDiff(body, diffText);
}
// The revision-timeline diff blocks of one file, freshly fetched (same /api/diff request the
// file-history view issues, consent flag included).
export async function fetchRevisionDiffBlocks(project, target, fullContents) {
    const params = new URLSearchParams({ project, file: target, mode: "revisions" });
    if (getConsentChoice(project) === "1") {
        params.set("allowScripts", "1");
    }
    const baselineChoice = getBaselineChoice(project); // task 56: same cached document
    if (baselineChoice !== null)
        params.set("preBaseline", baselineChoice);
    if (fullContents) {
        params.set("context", "full");
    }
    return splitDiffBlocks(await fetchText(`/api/diff?${params}`));
}
// One file change's revision diff in the right pane: its changeId resolves to a 1-based
// revision through the document's histories, that revision's block renders as a diff, and the
// no-hunk cases (renames, missing blocks) render their fallback explanation instead.
export async function showRevisionDiffInDetails(change, blocks, filesTouched, reload) {
    const link = change.changeId === undefined ? undefined : findRevisionForChangeId(filesTouched, change.changeId, undefined);
    const block = link?.revisionNumber === undefined ? undefined : blocks[link.revisionNumber - 1];
    const fallbackText = computeRevisionDiffFallbackText(block, change);
    // displayPath, not path (task 127): the pane label shows the entry-time file name.
    if (fallbackText !== undefined) {
        showTextInDetails(change.displayPath, fallbackText);
        return;
    }
    showDiffInDetails(change.displayPath, block, reload);
}

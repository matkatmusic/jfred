// Details pane right-column rendering (task 92): pane plumbing plus text/content/diff renders sharing the shownDiff toggle state.

import { el } from "../app-dom.ts";
import { getBaselineChoice, getConsentChoice } from "../app-choices.ts";
import { fetchText } from "../app-fetch.ts";
import { resetDetailsFind } from "./details-find.ts";
import { appendColumnsDiff, appendInlineDiff } from "../diff-render.ts";
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
    // Every right-pane render routes through here, so stale find-widget Ranges never survive a re-render (task 127).
    resetDetailsFind();
    const body = document.getElementById("details-right-body")!;
    body.replaceChildren();
    return body;
}

// The shown diff, kept for toggle re-renders; `reload` re-fetches since full-context is a different response (item 75).
let shownDiff: { label: string; diffText: string; reload: () => void; unrecoverableReason?: string } | undefined;

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

// task 126: the placeholder's banner stack — ⚠ banner, carried-forward note, previous-revision section title.
function appendUnrecoverableBanner(body: HTMLElement, reason: string): void {
    body.append(
        el("div", { class: "recon-banner" }, [
            el("span", { class: "warn", text: "⚠ Not reconstructed" }),
            ` — ${reason}`,
        ]),
        el("pre", { class: "diff-text", text: "(the previous revision's content is carried forward at this revision)" }),
        el("div", { class: "pane-title", text: "— previous revision content —" }),
    );
}

// task 126: ⚠ banner then the previous revision's diff; the reason rides shownDiff so toggles keep the banner.
export function showUnrecoverableInDetails(label: string, reason: string, previousDiffText: string | undefined, reload: () => void): void {
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

// One diff in the persisted toggle's layout; #dm-columns / #dm-inline re-render the SAME diff.
export function showDiffInDetails(label: string, diffText: string, reload: () => void, unrecoverableReason?: string): void {
    shownDiff = { label, diffText, reload, unrecoverableReason };
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
            showDiffInDetails(shownDiff.label, shownDiff.diffText, shownDiff.reload, shownDiff.unrecoverableReason);
        }
    };
    // Full contents widens git context, so it re-fetches via reload rather than re-rendering.
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

// The revision-timeline diff blocks of one file, freshly fetched (same /api/diff request the file-history view issues, consent flag included).
export async function fetchRevisionDiffBlocks(project: string, target: string, fullContents: boolean): Promise<string[]> {
    const params = new URLSearchParams({ project, file: target, mode: "revisions" });
    if (getConsentChoice(project) === "1") {
        params.set("allowScripts", "1");
    }
    const baselineChoice = getBaselineChoice(project);   // task 56: same cached document
    if (baselineChoice !== null) params.set("preBaseline", baselineChoice);
    if (fullContents) {
        params.set("context", "full");
    }
    return splitDiffBlocks(await fetchText(`/api/diff?${params}`));
}

// One change's revision diff: changeId resolves to a revision block; no-hunk cases render their fallback text.
export async function showRevisionDiffInDetails(change: FileChange, blocks: string[], filesTouched: WireFileHistory[], reload: () => void): Promise<void> {
    const link = change.changeId === undefined ? undefined : findRevisionForChangeId(filesTouched, change.changeId, undefined);
    const block = link?.revisionNumber === undefined ? undefined : blocks[link.revisionNumber - 1];
    const fallbackText = computeRevisionDiffFallbackText(block, change);
    // displayPath, not path (task 127): the pane label shows the entry-time file name.
    if (fallbackText !== undefined) {
        showTextInDetails(change.displayPath, fallbackText);
        return;
    }
    showDiffInDetails(change.displayPath, block!, reload);
}

// Timeline file chips: the letter+color chip, the active-chip highlight, and the per-file button row on an expanded agent turn.

import { el } from "../app-dom.ts";
import { RevisionViewMode } from "./details-model.ts";
import { renderDetailsFileMode } from "./details-revision-view.ts";
import { computeSnapshotJumpRoute } from "./timeline-changes.ts";
import { openTurnInspector } from "./timeline-render-inspectors.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import type { CommitNode, FileChange, TranscriptLocation, TurnNode } from "./timeline-types.ts";

// The letter half of a chip's letter+color badge (color alone never carries the meaning).
function computeOpLetter(change: FileChange): string {
    if (change.eventKind === "rename") {
        return "R";
    }
    if (change.eventKind === "delete") {
        return "D";
    }
    if (change.eventKind === "copy") {
        return "A";
    }
    if (change.eventKind === "user-edit") {
        return "U";
    }
    if (change.eventKind === "script-execution") {
        return "S";
    }
    if (change.eventKind === "write" && change.isFirstRevision) {
        return "A";
    }
    return "M";
}

function computeBaseName(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

// One file chip: letter badge + name ("old → new" for renames).
function renderFileChip(change: FileChange, onclick: EventListener): HTMLElement {
    const letter = computeOpLetter(change);
    // displayPath, not path (task 127): a pre-rename chip shows the name the file had then.
    const label = change.renamedFrom !== undefined
        ? `${computeBaseName(change.renamedFrom)} → ${computeBaseName(change.displayPath)}`
        : computeBaseName(change.displayPath);
    return el("span", { class: "timeline-chip", title: "Show revision in Inspector", onclick }, [
        el("span", { class: `op-badge op-${letter.toLowerCase()}`, text: letter }),
        el("span", { text: label }),
    ]);
}

export function clearActiveChip(context: TimelineRenderContext): void {
    if (context.activeChip === null) {
        return;
    }
    context.activeChip.classList.remove("active");
    context.activeChip = null;
}

// The chip whose file the Details pane is showing stays highlighted.
export function markChipActive(context: TimelineRenderContext, chipElement: HTMLElement): void {
    clearActiveChip(context);
    context.activeChip = chipElement;
    chipElement.classList.add("active");
}

function showCausingRecordForChip(event: Event, context: TimelineRenderContext, node: TurnNode | CommitNode, previewPane: HTMLElement, causingLocation: TranscriptLocation | undefined, change: FileChange, changeId: string): void {
    event.stopPropagation();
    // The turn fallback stays here since it needs `node`, which the Revision View has no notion of.
    if (causingLocation === undefined) {
        openTurnInspector(context, node, previewPane);
        return;
    }
    markChipActive(context, event.currentTarget as HTMLElement);
    renderDetailsFileMode(change.path, context.detailsContext, { changeId, mode: RevisionViewMode.record });
}

function appendCausingRecordChipButton(buttons: HTMLElement[], context: TimelineRenderContext, node: TurnNode | CommitNode, previewPane: HTMLElement, causingLocation: TranscriptLocation, change: FileChange, changeId: string): void {
    buttons.push(el("span", {
        class: "timeline-chip timeline-chip-action",
        title: "Show this file's causing record in inspector",
        text: "{ }",
        onclick: (event: Event) => showCausingRecordForChip(event, context, node, previewPane, causingLocation, change, changeId),
    }));
}

function showRevisionDiffForChip(event: Event, context: TimelineRenderContext, change: FileChange, changeId: string): void {
    event.stopPropagation();
    markChipActive(context, event.currentTarget as HTMLElement);
    renderDetailsFileMode(change.path, context.detailsContext, { changeId, mode: RevisionViewMode.diff });
}

function appendSnapshotJumpButton(buttons: HTMLElement[], context: TimelineRenderContext, change: FileChange, changeId: string): void {
    buttons.push(el("span", {
        class: "timeline-chip timeline-chip-action",
        title: "Show this specific File History Snapshot in File Revisions view",
        text: "📷",
        onclick: (event: Event) => {
            event.stopPropagation();
            markChipActive(context, event.currentTarget as HTMLElement);
            // Renders in the pane rather than setting location.hash, which reloaded the whole page.
            renderDetailsFileMode(change.path, context.detailsContext, { changeId, mode: RevisionViewMode.content });
        },
    }));
}

// One file's button row: each button deep-links into the Revision View, differing only in the mode requested.
export function renderFileButtonRow(context: TimelineRenderContext, node: TurnNode | CommitNode, nodeIndex: number, change: FileChange, previewPane: HTMLElement): HTMLElement {
    const causingLocation = context.chipLineLocations.get(`${nodeIndex}:${change.path}`);
    const buttons = [renderFileChip(change, (event: Event) => {
        event.stopPropagation();
        markChipActive(context, event.currentTarget as HTMLElement);
        // A chip with no changeId names no revision — open on #1, the treeview's own default.
        if (change.changeId === undefined) {
            renderDetailsFileMode(change.path, context.detailsContext);
            return;
        }
        renderDetailsFileMode(change.path, context.detailsContext, { changeId: change.changeId, mode: RevisionViewMode.content });
    })];
    if (change.changeId !== undefined) {
        // Narrowed once: TypeScript won't carry this narrowing into callbacks below, and non-null assertions are banned here.
        const changeId = change.changeId;
        // A synthetic `gitbase:` changeId has no causing line, so the { } chip shows nothing useful.
        if (causingLocation !== undefined) {
            appendCausingRecordChipButton(buttons, context, node, previewPane, causingLocation, change, changeId);
        }
        buttons.push(el("span", {
            class: "timeline-chip timeline-chip-action",
            title: "Show Diff in Inspector",
            text: "+/-",
            onclick: (event: Event) => showRevisionDiffForChip(event, context, change, changeId),
        }));
        // Computed as a presence test: undefined means no File History Snapshot, so the button's absence signals that (user-decided).
        const jumpRoute = computeSnapshotJumpRoute(context.project, context.reconstructionDocument.filesTouched, change);
        if (jumpRoute !== undefined) {
            appendSnapshotJumpButton(buttons, context, change, changeId);
        }
    }
    // The L:n label uses the same numbering as the details pane.
    buttons.push(el("span", { class: "timeline-time", text: new Date(change.when).toLocaleTimeString() }));
    if (causingLocation !== undefined) {
        buttons.push(el("span", {
            class: "timeline-time",
            text: `L:${causingLocation.line} (of ${causingLocation.rawLines.length - 1})`,
        }));
    }
    return el("div", { class: "timeline-chip-row" }, buttons);
}

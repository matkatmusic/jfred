// Task 92: inspector openers that resolve nodes to transcript lines and sync timeline selection.

import { el } from "../app-dom.ts";
import { fetchRawRecords } from "../app-fetch.ts";
import { openTranscriptInspector } from "../inspector.ts";
import { findLineForChangeId } from "./file-history-model.ts";
import { findTimelineNodeIndexForRawLine } from "./timeline-labels.ts";
import { findJsonlForSession } from "./timeline-sessions.ts";
import { LINE_NODE_KIND, type LineNode } from "./timeline-line-nodes.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import {
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    type CommitNode,
    type FileChange,
    type TimelineNode,
    type ToolCallNode,
    type TranscriptLocation,
    type TurnNode,
    type WireStepSnapshot,
} from "./timeline-types.ts";

// Probe all project JSONLs for the transcript line carrying a changeId.
export async function findTranscriptLineForChangeId(context: TimelineRenderContext, changeId: string): Promise<TranscriptLocation | undefined> {
    for (const file of context.listing?.jsonlFiles ?? []) {
        const rawLines = await fetchRawRecords(context.project, file.fileName);
        const line = findLineForChangeId(rawLines, changeId);
        if (line >= 0) {
            return { jsonlName: file.fileName, rawLines, line };
        }
    }
    return undefined;
}

// Item 43: sync timeline selection to the inspector's shown line on Prev/Next jumps.
export function syncSelectedRowToShownLine(context: TimelineRenderContext, rawLines: string[], shownLine: number): void {
    const nodeIndex = findTimelineNodeIndexForRawLine(context.nodes, rawLines[shownLine] ?? "");
    if (nodeIndex === -1) {
        return;
    }
    const row = context.nodeRows.get(nodeIndex);
    if (row === undefined) {
        return;
    }
    if (row === context.selectedRow) {
        return;
    }
    if (context.selectedRow !== null) {
        context.selectedRow.classList.remove("selected");
    }
    context.selectedRow = row;
    row.classList.add("selected");
    // Item 45: scroll only when the row is outside the pane; details pane already shows the inspector.
    row.scrollIntoView({ block: "nearest" });
}

// Wrapper that syncs timeline selection when the inspector's shown line changes (item 43).
export function openTranscriptInspectorSynced(context: TimelineRenderContext, options: { jsonlName: string; rawLines: string[]; line: number }): void {
    openTranscriptInspector({
        ...options,
        onJumpToLine: (shownLine) => syncSelectedRowToShownLine(context, options.rawLines, shownLine),
    });
    // Task 258: details pane reveal shrinks timeline; re-center the row post-reflow to avoid off-screen.
    context.selectedRow?.scrollIntoView({ block: "center" });
}

// Probe a snapshot's changeIds until one resolves; returns true when inspector opened.
async function tryOpenInspectorForSnapshot(context: TimelineRenderContext, snapshot: WireStepSnapshot): Promise<boolean> {
    for (const changeId of snapshot.changeIds) {
        const located = await findTranscriptLineForChangeId(context, changeId);
        if (located !== undefined) {
            openTranscriptInspectorSynced(context, located);
            return true;
        }
    }
    return false;
}

// Requirement 6: open inspector on the first resolvable changeId across snapshots.
export async function openStepInspector(context: TimelineRenderContext, node: TurnNode | CommitNode | LineNode, previewPane: HTMLElement): Promise<void> {
    for (const snapshot of node.snapshots ?? []) {     // a merged baseline commit row owns snapshots too (task 121)
        const opened = await tryOpenInspectorForSnapshot(context, snapshot);
        if (opened) {
            return;
        }
    }
    // Synthetic changeIds match no JSONL line; show a message instead.
    previewPane.classList.remove("hidden");
    previewPane.replaceChildren(el("div", { class: "muted", text: "no transcript line for this step (synthetic change id)" }));
}

// Open inspector on the turn's own JSONL record by uuid; falls back to changeId scan if absent.
export async function openTurnInspector(context: TimelineRenderContext, node: TurnNode | CommitNode | LineNode, previewPane: HTMLElement): Promise<void> {
    if (node.uuid === undefined) {
        openStepInspector(context, node, previewPane);
        return;
    }
    const jsonlName = findJsonlForSession(context.listing, node.sessionId);
    if (jsonlName === undefined) {
        openStepInspector(context, node, previewPane);
        return;
    }
    const rawLines = await fetchRawRecords(context.project, jsonlName);
    // Match the record's own uuid field to avoid landing on a snapshot that references it as messageId.
    let line = findLineForChangeId(rawLines, `"uuid":"${node.uuid}"`);
    if (line < 0) {
        line = findLineForChangeId(rawLines, node.uuid);
    }
    if (line < 0) {
        openStepInspector(context, node, previewPane);
        return;
    }
    openTranscriptInspectorSynced(context, { jsonlName, rawLines, line });
}

// Task 160: open inspector at the row's source coordinates, bypassing uuid scan.
async function openLineRowInspector(context: TimelineRenderContext, node: LineNode, previewPane: HTMLElement): Promise<void> {
    if (node.sourceJsonlName === undefined || node.sourceLineIndex === undefined) {
        await openTurnInspector(context, node, previewPane);   // pre-task-160 cached documents
        return;
    }
    const rawLines = await fetchRawRecords(context.project, node.sourceJsonlName);
    openTranscriptInspectorSynced(context, { jsonlName: node.sourceJsonlName, rawLines, line: node.sourceLineIndex });
}

// Item 66: dead helpers (items 47, 55) removed; see archive.

// Item 55: open the tool_use record's line, matched by the record's own uuid.
export async function openToolCallLine(context: TimelineRenderContext, node: ToolCallNode, previewPane: HTMLElement): Promise<void> {
    const jsonlName = node.sessionId === undefined ? undefined : findJsonlForSession(context.listing, node.sessionId);
    if (jsonlName === undefined) {
        previewPane.classList.remove("hidden");
        previewPane.replaceChildren(el("div", { class: "muted", text: "no transcript line for this tool call" }));
        return;
    }
    const rawLines = await fetchRawRecords(context.project, jsonlName);
    const line = findLineForChangeId(rawLines, `"uuid":"${node.uuid}"`);
    if (line < 0) {
        previewPane.classList.remove("hidden");
        previewPane.replaceChildren(el("div", { class: "muted", text: "no transcript line for this tool call" }));
        return;
    }
    openTranscriptInspectorSynced(context, { jsonlName, rawLines, line });
}

// Open the session transcript at its last line for session-end rows.
export async function openSessionEndTranscript(context: TimelineRenderContext, node: TimelineNode, previewPane: HTMLElement): Promise<void> {
    const jsonlName = findJsonlForSession(context.listing, node.sessionId);
    if (jsonlName === undefined) {
        previewPane.classList.remove("hidden");
        previewPane.replaceChildren(el("div", { class: "muted", text: "no transcript for this session" }));
        return;
    }
    const rawLines = await fetchRawRecords(context.project, jsonlName);
    openTranscriptInspectorSynced(context, { jsonlName, rawLines, line: rawLines.length - 1 });
}

// Per-kind inspector dispatch; avoids re-calling selectTimelineRow to prevent render loops.
export function openNodeInspector(context: TimelineRenderContext, nodeIndex: number): void {
    const node = context.nodes[nodeIndex]!;
    const previewPane = context.previewPanes.get(nodeIndex)!;
    if (node.kind === TOOL_CALL_NODE_KIND) {
        void openToolCallLine(context, node, previewPane);
        return;
    }
    if (node.kind === SESSION_END_NODE_KIND) {
        void openSessionEndTranscript(context, node, previewPane);
        return;
    }
    if (node.kind === COMMIT_NODE_KIND) {
        return;                                        // a commit is a repo event: no JSONL record
    }
    if (node.kind === LINE_NODE_KIND) {
        void openLineRowInspector(context, node, previewPane);
        return;
    }
    void openTurnInspector(context, node, previewPane);
}

// Resolve each turn's JSONL line label up front, one cached fetch per session.
export async function resolveLineLabels(context: TimelineRenderContext): Promise<void> {
    for (const [index, node] of context.nodes.entries()) {
        if (node.uuid === undefined) {
            continue;
        }
        const jsonlName = node.sessionId === undefined ? undefined : findJsonlForSession(context.listing, node.sessionId);
        if (jsonlName === undefined) {
            continue;
        }
        const rawLines = await fetchRawRecords(context.project, jsonlName);
        const line = findLineForChangeId(rawLines, `"uuid":"${node.uuid}"`);
        if (line < 0) {
            continue;
        }
        // Numbered like the details pane's "line n / max" (0-based, max index).
        context.lineLabels.set(index, `L:${line} (of ${rawLines.length - 1})`);
    }
}

// Locate one chip's causing record and store under its nodeIndex:path key.
async function resolveChipLineLocationForChange(context: TimelineRenderContext, index: number, change: FileChange): Promise<void> {
    if (change.changeId === undefined) {
        return;
    }
    const located = await findTranscriptLineForChangeId(context, change.changeId);
    if (located === undefined) {
        return;
    }
    context.chipLineLocations.set(`${index}:${change.path}`, located);
}

// Item 55: resolve each chip's causing-line location; synthetics fall back to the turn's line.
export async function resolveChipLineLocations(context: TimelineRenderContext): Promise<void> {
    for (const [index, node] of context.nodes.entries()) {
        for (const change of node.fileChanges ?? []) {
            await resolveChipLineLocationForChange(context, index, change);
        }
    }
}


// Timeline inspector openers (task 92 split from timeline.ts): resolving a node/changeId to its
// transcript (jsonl, line) and opening the inspector on it, with the timeline-selection sync.

import { el } from "../app-dom.ts";
import { fetchRawRecords } from "../app-fetch.ts";
import { openTranscriptInspector } from "../inspector.ts";
import { findLineForChangeId } from "./file-history-model.ts";
import { findTimelineNodeIndexForRawLine } from "./timeline-labels.ts";
import { findJsonlForSession } from "./timeline-sessions.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import {
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    type TimelineNode,
    type ToolCallNode,
    type TranscriptLocation,
    type TurnNode,
} from "./timeline-types.ts";

// The transcript line carrying a changeId, probed across the project's JSONLs (raw text is
// cached after the first fetch); undefined for synthetic changeIds that match no line.
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

// Item 43: keep the timeline's selected bubble on the step owning the inspector's shown
// line, so Prev/Next (and in-inspector jumps) walk the selection along the timeline. A
// line owned by no node (summary records, snapshot lines with re-stamped changeIds)
// keeps the current selection.
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
    // Item 45: bring the newly selected row into view; "nearest" scrolls only when the
    // row is outside the pane, so in-view steps don't jump. Selection-swap + scroll ONLY —
    // the details pane already shows the inspector that drove this sync (item 66).
    row.scrollIntoView({ block: "nearest" });
}

// Every timeline transcript-inspector open routes through this wrapper so line changes
// inside the inspector sync the timeline selection (item 43).
export function openTranscriptInspectorSynced(context: TimelineRenderContext, options: { jsonlName: string; rawLines: string[]; line: number }): void {
    openTranscriptInspector({
        ...options,
        onJumpToLine: (shownLine) => syncSelectedRowToShownLine(context, options.rawLines, shownLine),
    });
}

// ── inspector jump (requirement 6): turn -> first resolvable changeId -> (jsonl, line) ──
export async function openStepInspector(context: TimelineRenderContext, node: TurnNode, previewPane: HTMLElement): Promise<void> {
    for (const snapshot of node.snapshots) {
        for (const changeId of snapshot.changeIds) {
            const located = await findTranscriptLineForChangeId(context, changeId);
            if (located !== undefined) {
                openTranscriptInspectorSynced(context, located);
                return;
            }
        }
    }
    // Synthetic changeIds (user-edit / evidence splices) match no JSONL line — say so instead
    // of opening the inspector on nothing.
    previewPane.classList.remove("hidden");
    previewPane.replaceChildren(el("div", { class: "muted", text: "no transcript line for this step (synthetic change id)" }));
}

// Clicking a turn opens the transcript drawer on the message's OWN JSONL line (the record
// embedding its uuid — findLineForChangeId is a generic substring scan, so it resolves uuids
// too). Synthetic agent turns carry no uuid and fall back to the changeId scan above.
export async function openTurnInspector(context: TimelineRenderContext, node: TurnNode, previewPane: HTMLElement): Promise<void> {
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
    // Prefer the record whose OWN uuid field matches — a bare-uuid scan would land on the
    // file-history-snapshot line that references the message as its messageId.
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

// (item 66) the dead item-47 findRevisionResultLine/showRevisionJson comment block and the
// dead item-55 showGitOperationJson helper are deleted here — see the archive copy.

// { } button on a tool-call row (item 55): the tool_use record's line (or the hook attachment
// that rewrote the command), matched by the record's OWN uuid field. The inspector's
// line-sync then selects the row itself.
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

// The session transcript at its LAST line — a session-end row's opener (the old session-
// header link behavior, re-homed onto the row's { } button).
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

// The per-kind inspector opener shared by the { } buttons and the details pane
// (DetailsContext.openNodeInspector). Deliberately does NOT re-call selectTimelineRow —
// the details pane calls this while rendering, and reopening the selection would loop.
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
    void openTurnInspector(context, node, previewPane);
}

// Each turn's own JSONL line label ("L:<n> (of <total>)", numbered like the details pane),
// resolved up front — one cached raw fetch per session file.
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
        // Numbered exactly like the details pane's "line <n> / <max>" (0-based, max index).
        context.lineLabels.set(index, `L:${line} (of ${rawLines.length - 1})`);
    }
}

// Per-chip causing-line locations (item 55): each chip's { } opens its file's OWN causing
// record (the Write/Edit tool_use line — reverting item 47b, user-decided) and its row shows
// that line's L:n label. Synthetic changeIds resolve to no entry; their chips fall back to
// the turn's own message line. Keyed `${nodeIndex}:${path}` (chips are deduped by path).
export async function resolveChipLineLocations(context: TimelineRenderContext): Promise<void> {
    for (const [index, node] of context.nodes.entries()) {
        for (const change of node.fileChanges ?? []) {
            if (change.changeId === undefined) {
                continue;
            }
            const located = await findTranscriptLineForChangeId(context, change.changeId);
            if (located === undefined) {
                continue;
            }
            context.chipLineLocations.set(`${index}:${change.path}`, located);
        }
    }
}

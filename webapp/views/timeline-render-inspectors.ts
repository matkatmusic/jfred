// Task 92: inspector openers that resolve nodes to transcript lines.

import { createElement } from "../app-dom.ts";
import { fetchRawRecords } from "../app-fetch.ts";
import { findLineForChangeId } from "./file-history-model.ts";
import { openTranscriptInspectorSynced } from "./timeline-inspector-sync.ts";
import { findJsonlForSession } from "./timeline-sessions.ts";
import { LINE_NODE_KIND, type LineNode } from "./timeline-line-nodes.ts";
import { findTranscriptLineForChangeId } from "./timeline-line-locations.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND } from "./timeline-types.ts";
import type { CommitNode, TimelineNode, ToolCallNode, TurnNode } from "./timeline-node-types.ts";
import type { WireStepSnapshot } from "./timeline-wire-types.ts";

// Probe a snapshot's changeIds until one resolves; returns true when inspector opened.
async function openInspectorForSnapshot(context: TimelineRenderContext, snapshot: WireStepSnapshot): Promise<boolean> {
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
    const opened = await openInspectorForSnapshot(context, snapshot);
    if (opened) {
      return;
    }
  }
  // Synthetic changeIds match no JSONL line; show a message instead.
  previewPane.classList.remove("hidden");
  previewPane.replaceChildren(createElement("div", { class: "muted", text: "no transcript line for this step (synthetic change id)" }));
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
  const { sourceJsonlName, sourceLineIndex } = node;
  if (sourceJsonlName === undefined) {
    await openTurnInspector(context, node, previewPane);   // pre-task-160 cached documents
    return;
  }
  if (sourceLineIndex === undefined) {
    await openTurnInspector(context, node, previewPane);   // pre-task-160 cached documents
    return;
  }
  const rawLines = await fetchRawRecords(context.project, sourceJsonlName);
  openTranscriptInspectorSynced(context, { jsonlName: sourceJsonlName, rawLines, line: sourceLineIndex });
}

// Item 55: open the tool_use record's line, matched by the record's own uuid.
export async function openToolCallLine(context: TimelineRenderContext, node: ToolCallNode, previewPane: HTMLElement): Promise<void> {
  const jsonlName = node.sessionId === undefined ? undefined : findJsonlForSession(context.listing, node.sessionId);
  if (jsonlName === undefined) {
    previewPane.classList.remove("hidden");
    previewPane.replaceChildren(createElement("div", { class: "muted", text: "no transcript line for this tool call" }));
    return;
  }
  const rawLines = await fetchRawRecords(context.project, jsonlName);
  const line = findLineForChangeId(rawLines, `"uuid":"${node.uuid}"`);
  if (line < 0) {
    previewPane.classList.remove("hidden");
    previewPane.replaceChildren(createElement("div", { class: "muted", text: "no transcript line for this tool call" }));
    return;
  }
  openTranscriptInspectorSynced(context, { jsonlName, rawLines, line });
}

// Open the session transcript at its last line for session-end rows.
export async function openSessionEndTranscript(context: TimelineRenderContext, node: TimelineNode, previewPane: HTMLElement): Promise<void> {
  const jsonlName = findJsonlForSession(context.listing, node.sessionId);
  if (jsonlName === undefined) {
    previewPane.classList.remove("hidden");
    previewPane.replaceChildren(createElement("div", { class: "muted", text: "no transcript for this session" }));
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

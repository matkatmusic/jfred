// Row summary text, session short labels, and timestamps for the revision timeline (split from timeline.ts).

import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND } from "./timeline-types.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

// Capped so the row's [{ }] button, timestamp, and L:n label stay visible (item 55).
const TOOL_CALL_SUMMARY_MAX_CHARS = 50;
export function trimToolCallSummary(summary: string): string {
  const firstLine = summary.split("\n")[0]!;
  if (firstLine.length <= TOOL_CALL_SUMMARY_MAX_CHARS) {
    return firstLine;
  }
  return `${firstLine.slice(0, TOOL_CALL_SUMMARY_MAX_CHARS)}…`;
}

// Single home for session shortening so uuid column, sidebar, and session-end rows agree (item 66).
export function computeSessionShortLabel(sessionId: string): string {
  return sessionId.slice(0, 8);
}

// Summary lines carry no date field, so a blank cell beats "Invalid Date" (task 160).
export function formatRowTimestamp(when: string): string {
  const stamp = new Date(when);
  const isInvalidDate = Number.isNaN(stamp.getTime());
  if (isInvalidDate) {
    return "";
  }
  return stamp.toLocaleString();
}

// A row's collapsed one-line text, per node kind (item 66).
export function computeRowSummaryText(node: TimelineNode): string {
  if (node.kind === COMMIT_NODE_KIND) {
    if (node.text !== undefined) {
      return node.text;
    }
    return node.detail ?? "git commit";
  }
  if (node.kind === SESSION_END_NODE_KIND) {
    return `end of session ${computeSessionShortLabel(node.sessionId)}`;
  }
  if (node.kind === TOOL_CALL_NODE_KIND) {
    return `${node.toolName}(${trimToolCallSummary(node.summary)})`;
  }
  const firstLine = node.text.split("\n")[0]!;
  const isAgentTurn = node.kind === AGENT_TURN_NODE_KIND;
  const isBlankFirstLine = firstLine.trim() === "";
  const isToolActivity = isAgentTurn && isBlankFirstLine;
  if (isToolActivity) {
    return "(tool activity)";
  }
  return firstLine;
}

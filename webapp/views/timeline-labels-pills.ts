// Role pills and session-start labels for the revision timeline (split from timeline-labels.ts).

import { AGENT_TURN_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND } from "./timeline-types.ts";
import type { FileChange, TimelineNode } from "./timeline-node-types.ts";

// Wire event kind of a script-made revision (mirrors EventKind.scriptExecution).
export const SCRIPT_EXECUTION_EVENT_KIND = "script-execution";

// Shared by the role-pill path and the merged base-commit row's dress (task 121).
export const GIT_BASELINE_ROLE_PILL_LABEL = "git-derived baseline";

// sessionTitles is optional because older cached documents predate the field.
export function computeSessionStartLabel(sessionTitles: Record<string, string> | undefined, sessionId: string): string {
  const title = sessionTitles === undefined ? undefined : sessionTitles[sessionId];
  if (title === undefined) {
    return `Session started: ${sessionId}`;
  }
  return `Session ${title} started: ${sessionId}`;
}

// Marker rows go before these indexes, so an interleaved multi-JSONL project shows where each session began.
export function findSessionStartIndexes(nodes: TimelineNode[]): { nodeIndex: number; sessionId: string }[] {
  const starts: { nodeIndex: number; sessionId: string }[] = [];
  const seenSessionIds = new Set<string>();
  for (const [nodeIndex, node] of nodes.entries()) {
    if (node.sessionId === undefined) {
      continue;
    }
    const isSessionSeen = seenSessionIds.has(node.sessionId);
    if (isSessionSeen) {
      continue;
    }
    seenSessionIds.add(node.sessionId);
    starts.push({ nodeIndex, sessionId: node.sessionId });
  }
  return starts;
}

function containsScriptExecutionChange(fileChanges: FileChange[]): boolean {
  for (const change of fileChanges) {
    if (change.eventKind === SCRIPT_EXECUTION_EVENT_KIND) {
      return true;
    }
  }
  return false;
}

// Commit and session-end rows get no pill because their text already names them (task 86).
export function computeRolePillLabel(node: TimelineNode): string | undefined {
  if (node.kind === USER_TURN_NODE_KIND) {
    return "User";
  }
  if (node.kind === TOOL_CALL_NODE_KIND) {
    return "Tool";
  }
  if (node.kind !== AGENT_TURN_NODE_KIND) {
    return undefined;
  }
  if (node.isGitBaseline === true) {
    return GIT_BASELINE_ROLE_PILL_LABEL;
  }
  const ranScript = containsScriptExecutionChange(node.fileChanges ?? []);
  if (ranScript) {
    return "Script";
  }
  return "Agent";
}

// Multi-word labels hyphenate so the CSS class stays a single token.
export function computeRolePillClass(label: string): string {
  return `role-pill-${label.toLowerCase().replaceAll(" ", "-")}`;
}

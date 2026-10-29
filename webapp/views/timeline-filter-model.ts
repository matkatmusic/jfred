// Timeline event-type filter: mode vocabulary and the per-node mode predicate.

import { SCRIPT_EXECUTION_EVENT_KIND } from "./timeline-labels-pills.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND, USER_TURN_NODE_KIND } from "./timeline-types.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

// View-only vocabulary, so it stays out of src/structures/vocabulary.ts.
export const TIMELINE_FILTER_MODES = Object.freeze({
  all: "all",
  conversation: "conversation",
  tools: "tools",
  scripts: "scripts",
  files: "files",
  git: "git",
} as const);
export type TimelineFilterMode = (typeof TIMELINE_FILTER_MODES)[keyof typeof TIMELINE_FILTER_MODES];

// Ordered [mode, label] pairs for the filter bar; All leads as the default.
export const TIMELINE_FILTER_BUTTONS: readonly (readonly [TimelineFilterMode, string])[] = Object.freeze([
  [TIMELINE_FILTER_MODES.all, "All"],
  [TIMELINE_FILTER_MODES.conversation, "Conversation"],
  [TIMELINE_FILTER_MODES.tools, "Tools"],
  [TIMELINE_FILTER_MODES.scripts, "Scripts"],
  [TIMELINE_FILTER_MODES.files, "Files"],
  [TIMELINE_FILTER_MODES.git, "Git"],
]);

// A conversational row is a user or agent turn.
function isConversationTurnNode(node: TimelineNode): boolean {
  if (node.kind === USER_TURN_NODE_KIND) {
    return true;
  }
  if (node.kind === AGENT_TURN_NODE_KIND) {
    return true;
  }
  return false;
}

// Same rule as the "Script" role pill: a script tool call, or an agent turn with a script revision.
function isScriptRunNode(node: TimelineNode): boolean {
  if (node.kind === TOOL_CALL_NODE_KIND) {
    if (node.scriptRun !== undefined) {
      return true;
    }
  }
  if (node.kind === AGENT_TURN_NODE_KIND) {
    const fileChanges = node.fileChanges ?? [];
    for (const change of fileChanges) {
      if (change.eventKind === SCRIPT_EXECUTION_EVENT_KIND) {
        return true;
      }
    }
  }
  return false;
}

// A file-modifying row has file-change chips, or a script run that changed files.
function isFileModifyingNode(node: TimelineNode): boolean {
  const fileChanges = node.fileChanges ?? [];
  if (fileChanges.length > 0) {
    return true;
  }
  if (node.kind === TOOL_CALL_NODE_KIND) {
    if (node.scriptRun !== undefined) {
      return node.scriptRun.changedPaths.length > 0;
    }
  }
  return false;
}

// Does `node` stay visible under `mode`? Session-end rows stay visible in every mode.
export function isNodeInFilterMode(node: TimelineNode, mode: TimelineFilterMode): boolean {
  if (mode === TIMELINE_FILTER_MODES.all) {
    return true;
  }
  if (node.kind === SESSION_END_NODE_KIND) {
    return true;
  }
  if (mode === TIMELINE_FILTER_MODES.conversation) {
    return isConversationTurnNode(node);
  }
  if (mode === TIMELINE_FILTER_MODES.tools) {
    return node.kind === TOOL_CALL_NODE_KIND;
  }
  if (mode === TIMELINE_FILTER_MODES.scripts) {
    return isScriptRunNode(node);
  }
  if (mode === TIMELINE_FILTER_MODES.files) {
    return isFileModifyingNode(node);
  }
  return node.kind === COMMIT_NODE_KIND;
}

// Timeline node assembly: wire messages, snapshots, git operations, and tool calls become the sorted, numbered node list.

import { buildRevisionIndex } from "./timeline-changes.ts";
import { applyNodeFileChanges } from "./timeline-node-file-changes.ts";
import { deriveLineNodes } from "./timeline-line-nodes.ts";
import { attachSnapshotsToAgentTurns } from "./timeline-node-attach.ts";
import { buildCommitNodes, buildToolCallNodes } from "./timeline-node-derive.ts";
import { compareTimelineNodes, filterPreBaselineNodes, setStepNumbers } from "./timeline-node-order.ts";
import { AGENT_TURN_NODE_KIND, SESSION_END_NODE_KIND, USER_ROLE, USER_TURN_NODE_KIND } from "./timeline-types.ts";
import type { SessionEndNode, TimelineNode, ToolCallNode, TurnNode } from "./timeline-node-types.ts";
import type { WireTimelineDocument } from "./timeline-wire-types.ts";

// (item 66) The dead git-row machinery lives on in webapp/archive/timeline-pre-item66.ts.

// One session-end node per session, timestamped at the session's last turn or tool call; unattributed turns get none.
function appendSessionEndNodes(turnNodes: (TurnNode | SessionEndNode)[], toolCallNodes: ToolCallNode[]): void {
  const lastTurnTimes = new Map<string, string>();
  const storeSessionInstant = (sessionId: string | undefined, when: string): void => {
    if (sessionId === undefined) {
      return;
    }
    const latest = lastTurnTimes.get(sessionId);
    if (latest === undefined) {
      lastTurnTimes.set(sessionId, when);
      return;
    }
    if (when > latest) {
      lastTurnTimes.set(sessionId, when);
    }
  };
  for (const node of turnNodes) {
    storeSessionInstant(node.sessionId, node.when);
  }
  for (const node of toolCallNodes) {
    storeSessionInstant(node.sessionId, node.when);
  }
  for (const [sessionId, when] of lastTurnTimes) {
    turnNodes.push({ kind: SESSION_END_NODE_KIND, when, sessionId, snapshots: [] });
  }
}

// True when the text is harness-generated (slash-command envelopes, system reminders), not typed or authored.
function isMessageTextSystem(text: string): boolean {
  const hasCommandEnvelope = text.includes("<command-");
  if (hasCommandEnvelope) {
    return true;
  }
  const hasLocalCommandEnvelope = text.includes("<local-command-");
  if (hasLocalCommandEnvelope) {
    return true;
  }
  return text.includes("<system-reminder>");
}

// One node per turn plus session ends, commits, and tool rows; snapshots attach to the first owning agent turn.
export function buildTurnTimelineViewModel(document: WireTimelineDocument, includeAllLines = false): { nodes: TimelineNode[] } {
  const revisionIndex = buildRevisionIndex(document);
  const turnNodes: TurnNode[] = [];
  for (const message of document.messages) {
    turnNodes.push({
      kind: message.role === USER_ROLE ? USER_TURN_NODE_KIND : AGENT_TURN_NODE_KIND,
      when: message.timestamp,
      sessionId: message.sessionId,
      uuid: message.uuid,
      text: message.text,
      isSystem: isMessageTextSystem(message.text),
      isOrphaned: message.isOrphaned === true,
      snapshots: [],
      gitOperations: [],
    });
  }
  // (task 121) Commit nodes derive before snapshots attach so the baseline merge can find the base-commit row.
  const commitNodes = buildCommitNodes(document);
  attachSnapshotsToAgentTurns(turnNodes, commitNodes, document.steps);
  // (item 55) old: attachGitOperationsToAgentTurns(turnNodes, document.gitOperations ?? []); replaced by tool-call nodes.
  const toolCallNodes = buildToolCallNodes(document);
  appendSessionEndNodes(turnNodes, toolCallNodes);
  // task 134: opt-in raw-line rows for every record not already a turn or tool row.
  const lineNodes = includeAllLines ? deriveLineNodes(document) : [];
  const sortedNodes = [...turnNodes, ...commitNodes, ...toolCallNodes, ...lineNodes].sort(compareTimelineNodes);
  // (task 56) Drop pre-baseline nodes before numbering so step 1 is the baseline node.
  const nodes = filterPreBaselineNodes(sortedNodes, document.preBaselineSkipped === true);
  setStepNumbers(nodes);
  applyNodeFileChanges(nodes, revisionIndex);
  return { nodes };
}

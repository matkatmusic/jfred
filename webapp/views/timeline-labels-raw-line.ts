// Raw-line ownership for the revision timeline (split from timeline-labels.ts).

import {
  AGENT_TURN_NODE_KIND,
  TOOL_CALL_NODE_KIND,
  USER_TURN_NODE_KIND,
  type TimelineNode,
} from "./timeline-types.ts";

type RawLineOwnerCheck = (node: TimelineNode, rawLineText: string) => boolean;

// Matches by changeId or the turn's own record uuid, so stepping onto a reply's line selects it (item 55).
function isRawLineOwnedByAgentTurn(node: TimelineNode, rawLineText: string): boolean {
  if (node.kind !== AGENT_TURN_NODE_KIND) {
    return false;
  }
  if (node.uuid !== undefined) {
    const mentionsTurnUuid = rawLineText.includes(`"uuid":"${node.uuid}"`);
    if (mentionsTurnUuid) {
      return true;
    }
  }
  for (const snapshot of node.snapshots) {
    for (const changeId of snapshot.changeIds) {
      const mentionsChangeId = rawLineText.includes(changeId);
      if (mentionsChangeId) {
        return true;
      }
    }
  }
  return false;
}

// The ls row and its rtk-rewrite row share a toolUseId, so each row must resolve by record first.
function isRawLineOwnedByToolCallRecord(node: TimelineNode, rawLineText: string): boolean {
  if (node.kind !== TOOL_CALL_NODE_KIND) {
    return false;
  }
  return rawLineText.includes(`"uuid":"${node.uuid}"`);
}

// Hook attachments and tool_result records carry the toolu id, mapping back to the call (item 55).
function isRawLineOwnedByToolCallReference(node: TimelineNode, rawLineText: string): boolean {
  if (node.kind !== TOOL_CALL_NODE_KIND) {
    return false;
  }
  return rawLineText.includes(node.toolUseId!);
}

// Must match the record's own uuid field; a substring match wrongly hits prompt references (s39 bug, item 55).
function isRawLineOwnedByUserTurn(node: TimelineNode, rawLineText: string): boolean {
  if (node.kind !== USER_TURN_NODE_KIND) {
    return false;
  }
  return rawLineText.includes(`"uuid":"${node.uuid!}"`);
}

function findNodeIndexOwningRawLine(nodes: TimelineNode[], rawLineText: string, isOwner: RawLineOwnerCheck): number {
  for (const [nodeIndex, node] of nodes.entries()) {
    const ownsRawLine = isOwner(node, rawLineText);
    if (ownsRawLine) {
      return nodeIndex;
    }
  }
  return -1;
}

// Tier order matters: a line carrying both a changeId and a prompt uuid is about the file change.
export function findTimelineNodeIndexForRawLine(nodes: TimelineNode[], rawLineText: string): number {
  const agentTurnIndex = findNodeIndexOwningRawLine(nodes, rawLineText, isRawLineOwnedByAgentTurn);
  if (agentTurnIndex >= 0) {
    return agentTurnIndex;
  }
  const toolCallRecordIndex = findNodeIndexOwningRawLine(nodes, rawLineText, isRawLineOwnedByToolCallRecord);
  if (toolCallRecordIndex >= 0) {
    return toolCallRecordIndex;
  }
  const toolCallReferenceIndex = findNodeIndexOwningRawLine(nodes, rawLineText, isRawLineOwnedByToolCallReference);
  if (toolCallReferenceIndex >= 0) {
    return toolCallReferenceIndex;
  }
  return findNodeIndexOwningRawLine(nodes, rawLineText, isRawLineOwnedByUserTurn);
}

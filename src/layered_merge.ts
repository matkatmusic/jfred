// Task 202 (spec S5): merged multi-session view: shared axis, one end state, re-derived gaps, corroboration marks.

import { LayeredNodeKind } from "./structures/vocabulary_views.ts";
import type { Path } from "./structures/domain.ts";
import { isNodeCarryingBytes } from "./layered_anchor.ts";
import { sortNodesOntoAxis } from "./layered_instants.ts";
import { insertPresumedUserEditGaps } from "./layered_end_state.ts";
import type {
  EndStateNode,
  MergedNode,
  MergedTimeline,
  ReconstructionEntity,
  SessionTimeline,
  TimelineNode,
} from "./layered_types.ts";

// One session's evidence node, carrying the session that observed it.
interface OwnedNode {
  node: TimelineNode;
  sessionFile: Path;
}

// End states and gaps are re-derived at merge level, not carried per-session.
function isNodeRederived(node: TimelineNode): boolean {
  const isEndState = node.kind === LayeredNodeKind.endState;
  const isPresumedGap = node.kind === LayeredNodeKind.presumedUserEdit;
  return isEndState || isPresumedGap;
}

// One session timeline's evidence nodes, each tagged with the session that observed it.
function listSessionEvidenceNodes(sessionTimeline: SessionTimeline): OwnedNode[] {
  const ownedNodes: OwnedNode[] = [];
  for (const node of sessionTimeline.timeline.nodes) {
    const isRederived = isNodeRederived(node);
    if (isRederived) {
      continue;
    }
    ownedNodes.push({ node, sessionFile: sessionTimeline.sessionFile });
  }
  return ownedNodes;
}

// Every session-owned evidence node across the entity, in session-timeline order.
function listOwnedEvidenceNodes(entity: ReconstructionEntity): OwnedNode[] {
  const ownedNodes: OwnedNode[] = [];
  for (const sessionTimeline of entity.sessionTimelines) {
    ownedNodes.push(...listSessionEvidenceNodes(sessionTimeline));
  }
  return ownedNodes;
}

// All sessions share the same on-disk end state; first match suffices.
// ponytail: every session read one disk, so a per-session end-state disagreement is a loader bug.
function findMergedEndStateNode(entity: ReconstructionEntity): EndStateNode | undefined {
  for (const sessionTimeline of entity.sessionTimelines) {
    for (const node of sessionTimeline.timeline.nodes) {
      if (node.kind === LayeredNodeKind.endState) {
        return node;
      }
    }
  }
  return undefined;
}

// True when the session is already in the list.
function containsSession(sessions: Path[], session: Path): boolean {
  for (const listed of sessions) {
    const isSame = listed.equals(session);
    if (isSame) {
      return true;
    }
  }
  return false;
}

// Groups byte-carrying nodes by content, mapping each to the distinct sessions that saw it.
function listSessionsByContent(owned: OwnedNode[]): Map<string, Path[]> {
  const sessionsByContent = new Map<string, Path[]>();
  for (const entry of owned) {
    const node = entry.node;
    const carriesBytes = isNodeCarryingBytes(node);
    if (!carriesBytes) {
      continue;
    }
    const sessions = sessionsByContent.get(node.content) ?? [];
    sessionsByContent.set(node.content, sessions);
    const alreadyListed = containsSession(sessions, entry.sessionFile);
    if (alreadyListed) {
      continue;
    }
    sessions.push(entry.sessionFile);
  }
  return sessionsByContent;
}

// Returns other sessions that independently observed the same content (requires two or more).
function listCorroboratingSessions(
  node: TimelineNode,
  ownSession: Path | undefined,
  sessionsByContent: Map<string, Path[]>,
): Path[] {
  const carriesBytes = isNodeCarryingBytes(node);
  if (!carriesBytes) {
    return [];
  }
  const sessions = sessionsByContent.get(node.content) ?? [];
  if (sessions.length < 2) {
    return [];
  }
  const otherSessions: Path[] = [];
  for (const session of sessions) {
    const isOwnSession = ownSession !== undefined && session.equals(ownSession);
    if (isOwnSession) {
      continue;
    }
    otherSessions.push(session);
  }
  return otherSessions;
}

// Merges all session timelines for one entity onto a shared axis with corroboration marks.
export function mergeSessionTimelines(entity: ReconstructionEntity): MergedTimeline {
  const owned = listOwnedEvidenceNodes(entity);
  const ownerBySessionNode = new Map<TimelineNode, Path>();
  const evidenceNodes: TimelineNode[] = [];
  for (const entry of owned) {
    ownerBySessionNode.set(entry.node, entry.sessionFile);
    evidenceNodes.push(entry.node);
  }
  const sorted = sortNodesOntoAxis(evidenceNodes);
  const endState = findMergedEndStateNode(entity);
  const positioned = endState === undefined ? sorted : [...sorted, endState];
  const sessionsByContent = listSessionsByContent(owned);
  const nodes: MergedNode[] = [];
  for (const node of insertPresumedUserEditGaps(positioned)) {
    const sessionFile = ownerBySessionNode.get(node);
    const corroboratedBy = listCorroboratingSessions(node, sessionFile, sessionsByContent);
    nodes.push({ node, sessionFile, corroboratedBy });
  }
  return { nodes };
}

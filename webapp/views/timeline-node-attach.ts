// Attaches step snapshots to the agent turn that owns them.

import { addGitBaselineSnapshot } from "./timeline-baseline-host.ts";
import { isSnapshotGitBaseline } from "./timeline-changes.ts";
import { AGENT_TURN_NODE_KIND } from "./timeline-types.ts";
import type { CommitNode, SnapshotInstant, TurnNode } from "./timeline-node-types.ts";
import type { WireStepSnapshot } from "./timeline-wire-types.ts";

// True when this agent turn can own the snapshot: same session, at or after it.
function isSnapshotOwnerCandidate(node: TurnNode, snapshot: SnapshotInstant): boolean {
  if (node.kind !== AGENT_TURN_NODE_KIND) {
    return false;
  }
  if (node.sessionId !== snapshot.sessionId) {
    return false;
  }
  return node.when >= snapshot.when;
}

function findSnapshotOwner(turnNodes: TurnNode[], snapshot: SnapshotInstant): TurnNode | undefined {
  for (const node of turnNodes) {
    const isOwner = isSnapshotOwnerCandidate(node, snapshot);
    if (isOwner) {
      return node;
    }
  }
  return undefined;
}

// Snapshots go to their owner turn; ownerless ones share a synthetic turn per session.
export function attachSnapshotsToAgentTurns(turnNodes: TurnNode[], commitNodes: CommitNode[], steps: WireStepSnapshot[]): void {
  const syntheticTurns = new Map<string | undefined, TurnNode>();
  let baselineHost: TurnNode | CommitNode | undefined;
  for (const snapshot of steps) {
    const isGitBaseline = isSnapshotGitBaseline(snapshot);
    if (isGitBaseline) {
      baselineHost = addGitBaselineSnapshot(turnNodes, commitNodes, snapshot, baselineHost);
      continue;
    }
    const owner = findSnapshotOwner(turnNodes, snapshot);
    if (owner !== undefined) {
      owner.snapshots.push(snapshot);
      continue;
    }
    const synthetic = syntheticTurns.get(snapshot.sessionId);
    if (synthetic !== undefined) {
      synthetic.snapshots.push(snapshot);
      synthetic.when = snapshot.when;
      continue;
    }
    const trailingTurn: TurnNode = {
      kind: AGENT_TURN_NODE_KIND,
      when: snapshot.when,
      sessionId: snapshot.sessionId,
      text: "",
      snapshots: [snapshot],
      gitOperations: [],
    };
    syntheticTurns.set(snapshot.sessionId, trailingTurn);
    turnNodes.push(trailingTurn);
  }
}

// Baseline host selection: gitBase-only steps land on the base-commit row, else a standalone baseline turn.

import { computeGitBaselineText, extractGitBaseCommitHash } from "./timeline-changes.ts";
import { AGENT_TURN_NODE_KIND } from "./timeline-types.ts";
import type { CommitNode, TurnNode } from "./timeline-node-types.ts";
import type { WireStepSnapshot } from "./timeline-wire-types.ts";

// The base-commit row: the commit node whose short resultHash prefixes the baseline beacon's commit hash.
function findBaseCommitNode(commitNodes: CommitNode[], snapshot: WireStepSnapshot): CommitNode | undefined {
  const baselineCommitHash = extractGitBaseCommitHash(snapshot.changeIds[0]!);
  for (const node of commitNodes) {
    if (node.resultHash === undefined) {
      continue;
    }
    if (node.resultHash === "") {
      continue;
    }
    const isBaseCommit = baselineCommitHash.startsWith(node.resultHash);
    if (isBaseCommit) {
      return node;
    }
  }
  return undefined;
}

// The node hosting baseline snapshots: the base-commit row, else a new baseline turn pushed into turnNodes.
function getBaselineHost(turnNodes: TurnNode[], commitNodes: CommitNode[], snapshot: WireStepSnapshot): TurnNode | CommitNode {
  const baseCommitNode = findBaseCommitNode(commitNodes, snapshot);
  if (baseCommitNode !== undefined) {
    baseCommitNode.isGitBaseline = true;
    baseCommitNode.text = computeGitBaselineText(snapshot);
    baseCommitNode.snapshots = [];
    return baseCommitNode;
  }
  const baselineTurn: TurnNode = {
    kind: AGENT_TURN_NODE_KIND,
    when: snapshot.when,
    sessionId: snapshot.sessionId,
    text: computeGitBaselineText(snapshot),
    isGitBaseline: true,
    snapshots: [],
    gitOperations: [],
  };
  turnNodes.push(baselineTurn);
  return baselineTurn;
}

// Attaches a gitBase-only snapshot to the baseline host, claiming it on first use; returns the host.
export function addGitBaselineSnapshot(turnNodes: TurnNode[], commitNodes: CommitNode[], snapshot: WireStepSnapshot, baselineHost: TurnNode | CommitNode | undefined): TurnNode | CommitNode {
  if (baselineHost === undefined) {
    baselineHost = getBaselineHost(turnNodes, commitNodes, snapshot);
  }
  baselineHost.snapshots!.push(snapshot);
  return baselineHost;
}

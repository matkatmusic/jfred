// Orders, numbers, and trims the timeline node list.

import { LINE_NODE_KIND } from "./timeline-line-nodes.ts";
import { COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND, type TimelineNode } from "./timeline-types.ts";

// Tie-break rank for nodes sharing a timestamp: turns, then tool rows, then commits, then session ends.
function computeNodeKindRank(kind: TimelineNode["kind"]): number {
  if (kind === SESSION_END_NODE_KIND) {
    return 3;
  }
  if (kind === COMMIT_NODE_KIND) {
    return 2;
  }
  if (kind === TOOL_CALL_NODE_KIND) {
    return 1;
  }
  return 0;
}

// Chronological; ties resolved by kind rank, insertion order otherwise (sort is stable).
export function compareTimelineNodes(a: TimelineNode, b: TimelineNode): number {
  if (a.when < b.when) {
    return -1;
  }
  if (a.when > b.when) {
    return 1;
  }
  return computeNodeKindRank(a.kind) - computeNodeKindRank(b.kind);
}

// Turns and session ends get stepNumber 1..N across sessions; commits, tool rows, and raw-line rows stay unnumbered.
export function setStepNumbers(nodes: TimelineNode[]): void {
  let stepNumber = 0;
  for (const node of nodes) {
    if (node.kind === COMMIT_NODE_KIND) {
      continue;
    }
    if (node.kind === TOOL_CALL_NODE_KIND) {
      continue;
    }
    if (node.kind === LINE_NODE_KIND) {
      continue;
    }
    stepNumber += 1;
    node.stepNumber = stepNumber;
  }
}

// When pre-baseline work was skipped, drop every node before the git-baseline node; no baseline node hides nothing.
export function filterPreBaselineNodes(nodes: TimelineNode[], preBaselineSkipped: boolean): TimelineNode[] {
  if (!preBaselineSkipped) {
    return nodes;
  }
  let baselineNode: TimelineNode | undefined;
  for (const node of nodes) {
    if (node.isGitBaseline === true) {
      baselineNode = node;
      break;
    }
  }
  if (baselineNode === undefined) {
    return nodes;
  }
  const keptNodes: TimelineNode[] = [];
  for (const node of nodes) {
    if (node.when >= baselineNode.when) {
      keptNodes.push(node);
    }
  }
  return keptNodes;
}

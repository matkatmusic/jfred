// Pick-selection logic: pickable rows, segment membership, pick legality, and the range summary.

import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "./timeline-types.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

// Only an agent turn that owns surviving snapshots can be picked.
export function checkNodeIsPickable(node: TimelineNode): boolean {
  if (node.kind !== AGENT_TURN_NODE_KIND) {
    return false;
  }
  if (node.isOrphaned) {
    return false;
  }
  return node.snapshots.length > 0;
}

// One pick-segment id per node: commits end a segment, unpickable nodes get null.
export function computePickSegments(nodes: TimelineNode[]): (number | null)[] {
  const segments: (number | null)[] = [];
  let segment = 0;
  for (const node of nodes) {
    if (node.kind === COMMIT_NODE_KIND) {
      segments.push(null);
      segment += 1;
      continue;
    }
    if (checkNodeIsPickable(node)) {
      segments.push(segment);
      continue;
    }
    segments.push(null);
  }
  return segments;
}

// A pick is legal when empty, or when it is every pickable node of one segment between its extremes.
export function checkPickIsLegal(nodes: TimelineNode[], pickedNodeIndexes: number[]): boolean {
  if (pickedNodeIndexes.length === 0) {
    return true;
  }
  const segments = computePickSegments(nodes);
  const pickedSegments = new Set(pickedNodeIndexes.map((index) => segments[index]));
  if (pickedSegments.size > 1) {
    return false;
  }
  const [segment] = pickedSegments;
  if (segment === null) {
    return false;
  }
  if (segment === undefined) {
    return false;
  }
  const min = Math.min(...pickedNodeIndexes);
  const max = Math.max(...pickedNodeIndexes);
  const picked = new Set(pickedNodeIndexes);
  for (let index = min; index <= max; index += 1) {
    if (segments[index] !== segment) {
      continue;
    }
    if (!picked.has(index)) {
      return false;
    }
  }
  return true;
}

// The selection bar summary: turn count, distinct file paths, and the 1-based snapshot index range.
export function computeRangeSummary(nodes: TimelineNode[], pickedNodeIndexes: number[]) {
  const pickedNodes = pickedNodeIndexes.map((index) => nodes[index]!);
  const filePaths = [...new Set(pickedNodes.flatMap((node) => node.fileChanges!.map((change) => change.path)))];
  const stepIndexes = pickedNodes.flatMap((node) => node.snapshots!.map((snapshot) => snapshot.index));
  return {
    stepCount: pickedNodes.length,
    filePaths,
    fromStepIndex: Math.min(...stepIndexes),
    toStepIndex: Math.max(...stepIndexes),
  };
}

// A click ending a text selection is a drag, not a close request; the close handler ignores it.
export function checkSelectionBlocksBackgroundClose(selection: { isCollapsed: boolean } | null): boolean {
  if (selection === null) {
    return false;
  }
  return selection.isCollapsed === false;
}

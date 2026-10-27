// Pick-selection logic: pickable rows, segment membership, pick legality, and the range summary.

import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND } from "./timeline-types.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

// Only an agent turn that owns surviving snapshots can be picked.
export function isNodePickable(node: TimelineNode): boolean {
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
    const isPickable = isNodePickable(node);
    if (isPickable) {
      segments.push(segment);
      continue;
    }
    segments.push(null);
  }
  return segments;
}

// A pick is legal when empty, or when it is every pickable node of one segment between its extremes.
export function isPickLegal(nodes: TimelineNode[], pickedNodeIndexes: number[]): boolean {
  if (pickedNodeIndexes.length === 0) {
    return true;
  }
  const segments = computePickSegments(nodes);
  const pickedSegments = new Set<number | null | undefined>();
  for (const index of pickedNodeIndexes) {
    pickedSegments.add(segments[index]);
  }
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
    const isPicked = picked.has(index);
    if (!isPicked) {
      return false;
    }
  }
  return true;
}

// The selection bar summary: turn count, distinct file paths, and the 1-based snapshot index range.
export function computeRangeSummary(nodes: TimelineNode[], pickedNodeIndexes: number[]) {
  const filePaths = new Set<string>();
  const stepIndexes: number[] = [];
  for (const index of pickedNodeIndexes) {
    const node = nodes[index]!;
    for (const change of node.fileChanges!) {
      filePaths.add(change.path);
    }
    for (const snapshot of node.snapshots!) {
      stepIndexes.push(snapshot.index);
    }
  }
  return {
    stepCount: pickedNodeIndexes.length,
    filePaths: [...filePaths],
    fromStepIndex: Math.min(...stepIndexes),
    toStepIndex: Math.max(...stepIndexes),
  };
}

// A click ending a text selection is a drag, not a close request; the close handler ignores it.
export function isSelectionBlockingBackgroundClose(selection: { isCollapsed: boolean } | null): boolean {
  if (selection === null) {
    return false;
  }
  return selection.isCollapsed === false;
}

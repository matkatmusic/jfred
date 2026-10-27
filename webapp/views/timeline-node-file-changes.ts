// Stamps merged file chips onto snapshot-owning timeline nodes.

import { computeFileChanges } from "./timeline-changes.ts";
import { TOOL_CALL_NODE_KIND, type FileChange, type RevisionIndex, type TimelineNode, type WireStepSnapshot } from "./timeline-types.ts";

// Merge dedupe key: distinct revisions of one file keep their chips; a repeat of the same revision collapses.
function computeMergedChipKey(change: FileChange): string {
  return `${change.path}|${change.changeId ?? ""}`;
}

// One snapshot's chips, skipping any already seen by path+changeId.
function mergeSnapshotFileChanges(snapshot: WireStepSnapshot, revisionIndex: RevisionIndex, seenChipKeys: Set<string>, changes: FileChange[]): void {
  for (const change of computeFileChanges(snapshot, revisionIndex)) {
    const chipKey = computeMergedChipKey(change);
    if (seenChipKeys.has(chipKey)) {
      continue;
    }
    seenChipKeys.add(chipKey);
    changes.push(change);
  }
}

function computeMergedFileChanges(snapshots: WireStepSnapshot[], revisionIndex: RevisionIndex): FileChange[] {
  const changes: FileChange[] = [];
  const seenChipKeys = new Set<string>();
  for (const snapshot of snapshots) {
    mergeSnapshotFileChanges(snapshot, revisionIndex, seenChipKeys, changes);
  }
  return changes;
}

// old (pre engine-stamped isOrphaned): checkTurnIsOrphaned, the snapshot-proxy orphan check, retired (task 121).

// fileChanges on every snapshot-owning node; tool-call nodes and plain commit rows own none.
export function applyNodeFileChanges(nodes: TimelineNode[], revisionIndex: RevisionIndex): void {
  for (const node of nodes) {
    if (node.kind === TOOL_CALL_NODE_KIND) {
      continue;
    }
    if (node.snapshots === undefined) {
      continue;
    }
    node.fileChanges = computeMergedFileChanges(node.snapshots, revisionIndex);
    // old: isOrphaned was a snapshot proxy; the engine now stamps it on the wire.
    // node.isOrphaned = checkTurnIsOrphaned(node.snapshots, revisionIndex);
  }
}

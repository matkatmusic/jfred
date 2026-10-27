// Layer 1 view: axis placement and ordering for orphan rows.

import { placeSnapshotsOnAxis } from "./layer1_snapshot_wire.ts";
import type { DiskFileState } from "./layer1_disk_walk.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Instant } from "./layered_types.ts";
import type { Layer1WireInstant, Layer1WireOrphan } from "./viewer_api_layer1.ts";

// Every instant here was resolve input; a miss is a bug, so fail loudly.
export function buildInstantOnAxis(offsets: Map<number, number>, instant: Instant): Layer1WireInstant {
  const axisPx = offsets.get(instant.getTime());
  if (axisPx === undefined) {
    throw new Error(`instant ${instant.toISOString()} is missing from the resolved ruler`);
  }
  return { instant, axisPx };
}

function compareRowsByInstant(left: Layer1WireOrphan, right: Layer1WireOrphan): number {
  return left.instant.getTime() - right.instant.getTime();
}

// Ascending, so a bucket's placement is its first row's axisPx and the page needs no Math.min.
export function sortRowsByInstant(rows: Layer1WireOrphan[]): Layer1WireOrphan[] {
  const sorted = [...rows];
  sorted.sort(compareRowsByInstant);
  return sorted;
}

// Slot 0 is the orphan's own node; its snapshots stack below it.
export function buildDiskOrphanRow(file: DiskFileState, nodeOffsetsPx: number[], snapshots?: SnapshotPlacement[]): Layer1WireOrphan {
  const placedSnapshots = placeSnapshotsOnAxis(snapshots, nodeOffsetsPx.slice(1));
  return {
    path: file.relativePath,
    instant: file.mtime,
    axisPx: nodeOffsetsPx[0]!,
    ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
  };
}

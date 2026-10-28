// Task 312 (spec S19): snapshot placements as Layer 1 wire nodes, keyed the way the view keys files.

import { collectSnapshotPlacements, type SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Instant } from "./layered_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import type { WireSnapshotOf } from "../webapp/layer1-wire.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS = "reading file-history snapshots";

// The server instantiation of the wire snapshot: Date instant, domain Path/Uuid.
export type Layer1WireSnapshot = WireSnapshotOf<Instant, Path, Uuid>;

// The separator is load-bearing: a bare startsWith lets "/tmp/ab" pass against "/tmp/a".
export function convertToProjectRelativePath(projectFolder: Path, absolutePath: string): string | undefined {
  const prefix = projectFolder.toString().replace(/\/$/, "") + "/";
  const isInsideProjectFolder = absolutePath.startsWith(prefix);
  if (!isInsideProjectFolder) {
    return undefined;
  }
  return absolutePath.slice(prefix.length);
}

// One session at a time so the per-file parse — this stage's whole cost — can be counted.
export function collectViewSnapshotsByRelativePath(
  projectFolder: Path,
  sessionFiles: readonly Path[],
  reportProgress: ProgressSink = () => {},
): Map<string, SnapshotPlacement[]> {
  const byRelativePath = new Map<string, SnapshotPlacement[]>();
  for (const [index, sessionFile] of sessionFiles.entries()) {
    reportProgress({
      kind: DocumentResponseKind.progress,
      label: LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS,
      current: index + 1,
      total: sessionFiles.length,
    });
    for (const [absolutePath, placements] of collectSnapshotPlacements([sessionFile])) {
      const relativePath = convertToProjectRelativePath(projectFolder, absolutePath);
      if (relativePath === undefined) {
        continue;
      }
      byRelativePath.set(relativePath, (byRelativePath.get(relativePath) ?? []).concat(placements));
    }
  }
  // Each call sorts within ONE session; the cross-session merge above is not ordered.
  for (const placements of byRelativePath.values()) {
    placements.sort(comparePlacementInstants);
  }
  return byRelativePath;
}

function comparePlacementInstants(left: SnapshotPlacement, right: SnapshotPlacement): number {
  return left.instant.getTime() - right.instant.getTime();
}

// One helper, so the pair ladder, the orphan ladder and the client mirror cannot drift.
export function listSnapshotInstants(placements: SnapshotPlacement[] | undefined): Date[] {
  const instants: Date[] = [];
  for (const placement of placements ?? []) {
    instants.push(placement.instant);
  }
  return instants;
}

// Parallel to listSnapshotInstants' output, positional not a lookup — same rule as the pair ladder.
export function createAxisWireSnapshots(placements: SnapshotPlacement[] | undefined, tailOffsetsPx: number[]): Layer1WireSnapshot[] {
  const wireSnapshots: Layer1WireSnapshot[] = [];
  for (const [node, placement] of (placements ?? []).entries()) {
    wireSnapshots.push({
      instant: placement.instant,
      axisPx: tailOffsetsPx[node]!,
      version: placement.version,
      sessionId: placement.sessionId,
      sessionFile: placement.sessionFile,
      // An absent line must stay absent: a `line: undefined` KEY differs under deep equality.
      ...(placement.line === undefined ? {} : { line: placement.line }),
      ...(placement.isBackupMissing ? { isBackupMissing: true } : {}),
    });
  }
  return wireSnapshots;
}

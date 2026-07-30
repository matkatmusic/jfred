// Task 312 (spec S19): snapshot placements as Layer 1 wire nodes, keyed the way the view keys files.

import { collectSnapshotPlacements, type SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Instant } from "./layered_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import type { WireSnapshotOf } from "../webapp/layer1-wire.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS = "reading file-history snapshots";

// The server instantiation of the wire snapshot: Date instant, domain Path/Uuid.
export type Layer1WireSnapshot = WireSnapshotOf<Instant, Path, Uuid>;

// The separator is load-bearing: a bare startsWith lets "/tmp/ab" pass against "/tmp/a".
export function relativizeToProjectFolder(projectFolder: Path, absolutePath: string): string | undefined {
    const prefix = projectFolder.toString().replace(/\/$/, "") + "/";
    if (!absolutePath.startsWith(prefix)) {
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
    sessionFiles.forEach((sessionFile, index) => {
        reportProgress({
            kind: DocumentResponseKind.progress,
            label: LAYER1_PROGRESS_LABEL_READING_SNAPSHOTS,
            current: index + 1,
            total: sessionFiles.length,
        });
        for (const [absolutePath, placements] of collectSnapshotPlacements([sessionFile])) {
            const relativePath = relativizeToProjectFolder(projectFolder, absolutePath);
            if (relativePath === undefined) {
                continue;
            }
            byRelativePath.set(relativePath, (byRelativePath.get(relativePath) ?? []).concat(placements));
        }
    });
    // Each call sorts within ONE session; the cross-session merge above is not ordered.
    for (const placements of byRelativePath.values()) {
        placements.sort((left, right) => left.instant.getTime() - right.instant.getTime());
    }
    return byRelativePath;
}

// One helper, so the pair ladder, the orphan ladder and the client mirror cannot drift.
export function listSnapshotInstants(placements: SnapshotPlacement[] | undefined): Date[] {
    return (placements ?? []).map((placement) => placement.instant);
}

// Parallel to listSnapshotInstants' output, positional not a lookup — same rule as the pair ladder.
export function placeSnapshotsOnAxis(placements: SnapshotPlacement[] | undefined, tailOffsetsPx: number[]): Layer1WireSnapshot[] {
    return (placements ?? []).map((placement, node) => ({
        instant: placement.instant,
        axisPx: tailOffsetsPx[node]!,
        version: placement.version,
        sessionId: placement.sessionId,
        sessionFile: placement.sessionFile,
        // An absent line must stay absent: a `line: undefined` KEY differs under deep equality.
        ...(placement.line === undefined ? {} : { line: placement.line }),
    }));
}

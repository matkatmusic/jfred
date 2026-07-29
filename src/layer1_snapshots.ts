// Task 310 (spec S19): per-session file-history snapshot placements; no blob bytes are read here.

import { Path, Uuid } from "./structures/domain.ts";
import { loadTranscript } from "./parse/loadTranscript.ts";
import { buildBackupTimeline, findCwd, type BackupPoint } from "./reconstruction_backup_timeline.ts";
import { findSessionId } from "./reconstruction_sidecar_reader.ts";

// `version` is the @vN the OWNING session assigned, so it identifies nothing on its own.
export type SnapshotPlacement = {
    path: Path;
    version: number;
    instant: Date;
    sessionId: Uuid;
    sessionFile: Path;
    line?: number;
    backupFileName: Path;
};

// Snapshot records are cumulative, so one backup entry repeats across many records.
function buildDedupeKey(owner: Uuid, backupFileName: Path, backupTime: Date): string {
    return `${owner.toString()}|${backupFileName.toString()}|${backupTime.getTime()}`;
}

// A null backupFileName holds no blob; an unresolvable owner could never be read back.
function buildPlacementsFromBackupPoints(
    fileKey: string,
    points: BackupPoint[],
    sessionFile: Path,
    fallbackSessionId: Uuid | undefined,
): SnapshotPlacement[] {
    const placements: SnapshotPlacement[] = [];
    const seenKeys = new Set<string>();
    for (const point of points) {
        const backupFileName = point.backupFileName;
        if (backupFileName === null) {
            continue;
        }
        const owner = point.sessionId ?? fallbackSessionId;
        if (owner === undefined) {
            continue;
        }
        const dedupeKey = buildDedupeKey(owner, backupFileName, point.backupTime);
        // Keeping the FIRST occurrence keeps the line where the snapshot was actually taken.
        if (seenKeys.has(dedupeKey)) {
            continue;
        }
        seenKeys.add(dedupeKey);
        placements.push({
            path: new Path(fileKey),
            version: point.version,
            instant: point.backupTime,
            sessionId: owner,
            sessionFile,
            line: point.line,
            backupFileName,
        });
    }
    return placements;
}

// Tolerant parsing matches the viewer's loader: a real session with unmodeled fields must still open.
function buildPlacementsForSession(sessionFile: Path): Map<string, SnapshotPlacement[]> {
    const records = loadTranscript(sessionFile.toString(), undefined, true).records;
    const timeline = buildBackupTimeline(records, findCwd(records));
    const fallbackSessionId = findSessionId(records);
    const placementsByPath = new Map<string, SnapshotPlacement[]>();
    for (const [fileKey, points] of timeline) {
        const placements = buildPlacementsFromBackupPoints(fileKey, points, sessionFile, fallbackSessionId);
        if (placements.length > 0) {
            placementsByPath.set(fileKey, placements);
        }
    }
    return placementsByPath;
}

// Per-session timelines are each sorted, but the cross-session merge is not.
function sortPlacementsByInstant(placementsByPath: Map<string, SnapshotPlacement[]>): void {
    for (const placements of placementsByPath.values()) {
        placements.sort((a, b) => a.instant.getTime() - b.instant.getTime());
    }
}

// Snapshot placements for every session, keyed by absolute file path and ordered by instant.
export function collectSnapshotPlacements(sessionFiles: Path[]): Map<string, SnapshotPlacement[]> {
    const merged = new Map<string, SnapshotPlacement[]>();
    for (const sessionFile of sessionFiles) {
        for (const [fileKey, placements] of buildPlacementsForSession(sessionFile)) {
            merged.set(fileKey, (merged.get(fileKey) ?? []).concat(placements));
        }
    }
    sortPlacementsByInstant(merged);
    return merged;
}

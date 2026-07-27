// Layer 2 snapshot beacons (task 201, spec S4): every non-null file-history backup point
// becomes a verified BeaconNode. Resolution is per-OWNING-session (Q12): the backup timeline
// stamps each point with the sessionId that took it, and that id is passed to the BackupReader
// — the same `abc123@vN` blob name recurs across sessions with different bytes, so a global
// name lookup would be wrong. Merging these onto session timelines is S5/task 202's job.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import { buildBackupTimeline, findCwd, type BackupPoint } from "./reconstruction_backup_timeline.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { BeaconNode } from "./layered_types.ts";

// The beacons for one path's backup points, in backupTime order (the timeline pre-sorts).
// A null backupFileName is version 1, which holds no blob — skipped, never handed to the reader.
function buildBeaconsFromBackupPoints(points: BackupPoint[], reader: BackupReader): BeaconNode[] {
    const beacons: BeaconNode[] = [];
    for (const point of points) {
        if (point.backupFileName === null) {
            continue;
        }
        beacons.push({
            kind: LayeredNodeKind.beacon,
            instant: point.backupTime,
            // The OWNING session's id rides along — the reader must read that session's copy.
            content: reader(point.backupFileName, point.sessionId),
            evidence: undefined,
        });
    }
    return beacons;
}

// The Layer 2 beacons per absolute file path: every snapshot blob the records evidence, resolved
// through its owning session's sidecar. Paths whose snapshots are all blobless get no entry.
export function collectSnapshotBeaconNodes(
    records: TranscriptRecord[],
    reader: BackupReader,
): Map<string, BeaconNode[]> {
    const timeline = buildBackupTimeline(records, findCwd(records));
    const beaconsByFile = new Map<string, BeaconNode[]>();
    for (const [fileKey, points] of timeline) {
        const beacons = buildBeaconsFromBackupPoints(points, reader);
        if (beacons.length > 0) {
            beaconsByFile.set(fileKey, beacons);
        }
    }
    return beaconsByFile;
}

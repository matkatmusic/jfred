// Resolve per-session backup points into BeaconNodes; global lookup fails because blob names collide across sessions.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import { buildBackupTimeline, findCwd, type BackupPoint } from "./reconstruction_backup_timeline.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import type { BeaconNode } from "./layered_types.ts";

// Null backupFileName means version 1 (blobless) — skip those, emit beacons for the rest.
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

// Collect per-file beacons from backup blobs; paths with only blobless snapshots are omitted.
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


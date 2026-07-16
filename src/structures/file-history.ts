import type { TranscriptRecord } from "./envelope.ts";
import { RecordType } from "./vocabulary.ts";
import { Path, Uuid } from "./domain.ts";

// Per-file backup entry inside a file-history snapshot (recon/07, recon/09).
// `backupFileName` is a Path pointer to external on-disk backup content (null
// for the first version of a file), NOT inline content. `version` increments per
// change. `backupTime` is the time the backup was taken.
export type FileHistoryBackup = {
    backupFileName: Path | null;
    version: number;
    backupTime: Date;
};

// A snapshot's per-file backup map, keyed by file Path. Encapsulates an internal
// string-keyed Map (keyed by the path's value) so lookup is O(1) by path value,
// while the public surface only speaks Path — no primitive key escapes.
export class FileBackupMap {
    readonly #byPath = new Map<string, FileHistoryBackup>();

    get(path: Path): FileHistoryBackup | undefined {
        return this.#byPath.get(path.toString());
    }

    set(path: Path, backup: FileHistoryBackup): void {
        this.#byPath.set(path.toString(), backup);
    }

    has(path: Path): boolean {
        return this.#byPath.has(path.toString());
    }

    get size(): number {
        return this.#byPath.size;
    }

    paths(): Path[] {
        return [...this.#byPath.keys()].map((value) => new Path(value));
    }

    entries(): Array<[Path, FileHistoryBackup]> {
        return [...this.#byPath.entries()].map(
            ([value, backup]) => [new Path(value), backup],
        );
    }

    // Re-emit the wire object form ({ "<path>": backup }) so the snapshot
    // round-trips losslessly to JSONL.
    toJSON(): Record<string, FileHistoryBackup> {
        return Object.fromEntries(this.#byPath);
    }
}

// The file-state payload carried by a `file-history-snapshot` record. It maps a
// file path to that file's current backup pointer at the time of the snapshot.
export type FileHistorySnapshot = {
    messageId: Uuid;
    timestamp: Date;
    trackedFileBackups: FileBackupMap;
};

export type FileHistorySnapshotMessage = {
    type: RecordType.fileHistorySnapshot;
    messageId: Uuid;
    snapshot: FileHistorySnapshot;
    isSnapshotUpdate: boolean;
};

function toPathOrNull(value: string | null): Path | null {
    if (value === null) {
        return null;
    }
    return new Path(value);
}

function hydrateBackup(raw: unknown): FileHistoryBackup {
    const backup = raw as {
        backupFileName: string | null;
        version: number;
        backupTime: string;
    };
    return {
        backupFileName: toPathOrNull(backup.backupFileName),
        version: backup.version,
        backupTime: new Date(backup.backupTime),
    };
}

function hydrateBackups(raw: unknown): FileBackupMap {
    const map = new FileBackupMap();
    for (const [path, backup] of Object.entries(raw as object)) {
        map.set(new Path(path), hydrateBackup(backup));
    }
    return map;
}

function hydrateSnapshot(raw: unknown): FileHistorySnapshot {
    const snapshot = raw as { messageId: string; timestamp: string; trackedFileBackups: unknown };
    return {
        messageId: new Uuid(snapshot.messageId),
        timestamp: new Date(snapshot.timestamp),
        trackedFileBackups: hydrateBackups(snapshot.trackedFileBackups),
    };
}

// Return the typed, hydrated file-history-snapshot view of a record, or undefined
// when the record is not a file-history-snapshot.
export function getFileHistorySnapshot(
    record: TranscriptRecord,
): FileHistorySnapshotMessage | undefined {
    if (record.type !== RecordType.fileHistorySnapshot) {
        return undefined;
    }
    const raw = record as unknown as {
        messageId: string;
        snapshot: unknown;
        isSnapshotUpdate: boolean;
    };
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: new Uuid(raw.messageId),
        snapshot: hydrateSnapshot(raw.snapshot),
        isSnapshotUpdate: raw.isSnapshotUpdate,
    };
}


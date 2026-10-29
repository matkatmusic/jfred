import type { TranscriptRecord } from "./envelope.ts";
import { RecordType } from "./vocabulary.ts";
import { Path, Uuid } from "./domain.ts";

// Per-file backup entry in a snapshot: `backupFileName` points to on-disk content, null for a first version.
export type FileHistoryBackup = {
  backupFileName: Path | null;
  version: number;
  backupTime: Date;
};

// A snapshot's per-file backup map: a string-keyed Map inside, but the public surface only speaks Path.
export class FileBackupMap {
  readonly #byPath = new Map<string, FileHistoryBackup>();

  get(path: Path): FileHistoryBackup | undefined {
    return this.#byPath.get(path.toString());
  }

  set(path: Path, backup: FileHistoryBackup): void {
    this.#byPath.set(path.toString(), backup);
  }

  contains(path: Path): boolean {
    return this.#byPath.has(path.toString());
  }

  get size(): number {
    return this.#byPath.size;
  }

  listPaths(): Path[] {
    const paths: Path[] = [];
    for (const value of this.#byPath.keys()) {
      paths.push(new Path(value));
    }
    return paths;
  }

  listEntries(): Array<[Path, FileHistoryBackup]> {
    const entries: Array<[Path, FileHistoryBackup]> = [];
    for (const [value, backup] of this.#byPath) {
      entries.push([new Path(value), backup]);
    }
    return entries;
  }

  // Re-emit the wire object form ({ "<path>": backup }) so the snapshot round-trips losslessly to JSONL.
  toJSON(): Record<string, FileHistoryBackup> {
    return Object.fromEntries(this.#byPath);
  }
}

// The payload of a `file-history-snapshot` record: each file path maps to its current backup pointer.
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

function parsePathOrNull(value: string | null): Path | null {
  if (value === null) {
    return null;
  }
  return new Path(value);
}

function parseBackup(raw: unknown): FileHistoryBackup {
  const backup = raw as {
    backupFileName: string | null;
    version: number;
    backupTime: string;
  };
  return {
    backupFileName: parsePathOrNull(backup.backupFileName),
    version: backup.version,
    backupTime: new Date(backup.backupTime),
  };
}

function parseBackups(raw: unknown): FileBackupMap {
  const map = new FileBackupMap();
  for (const [path, backup] of Object.entries(raw as object)) {
    map.set(new Path(path), parseBackup(backup));
  }
  return map;
}

function parseSnapshot(raw: unknown): FileHistorySnapshot {
  const snapshot = raw as { messageId: string; timestamp: string; trackedFileBackups: unknown };
  return {
    messageId: new Uuid(snapshot.messageId),
    timestamp: new Date(snapshot.timestamp),
    trackedFileBackups: parseBackups(snapshot.trackedFileBackups),
  };
}

// Return the typed, hydrated file-history-snapshot view of a record, or undefined when the record is not a file-history-snapshot.
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
    snapshot: parseSnapshot(raw.snapshot),
    isSnapshotUpdate: raw.isSnapshotUpdate,
  };
}


// Shared fixtures for the snapshot wire tests: session transcripts holding file-history snapshot records.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";
import { DISK_ONLY_FILE_MTIME, SHARED_FILE_MTIME } from "./layer1-view-test-helpers.ts";

export const SESSION_ONE = "b21d84c5-0000-0000-0000-000000000001";
export const SESSION_TWO = "d4a06b8f-0000-0000-0000-000000000002";

// An instant no commit and no mtime occupies, so a ruler entry there can only be the snapshot's.
export const SNAPSHOT_ONLY_INSTANT = "2026-07-01T16:00:00.000Z";

export function buildSessionCwdRecord(cwd: string, sessionId: string): object {
  return { type: RecordType.user, cwd, sessionId, message: { role: "user", content: "hi" } };
}

export function buildSnapshotRecord(path: string, backupFileName: string, version: number, backupTime: string): object {
  return {
    type: RecordType.fileHistorySnapshot,
    messageId: `m-${path}-${backupTime}`,
    isSnapshotUpdate: false,
    snapshot: {
      messageId: `m-${path}-${backupTime}`,
      timestamp: backupTime,
      trackedFileBackups: { [path]: { backupFileName, version, backupTime } },
    },
  };
}

export function writeSessionTranscript(treeRoot: string, sessionId: string, records: object[]): Path {
  const projectDir = join(treeRoot, "projects", "-demo");
  mkdirSync(projectDir, { recursive: true });
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(jsonlPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  return new Path(jsonlPath);
}

// One session snapshotting shared.txt twice, once where nothing else sits, once ON its mtime, and disk-only.txt on ITS mtime.
export function writeFixtureSessions(diskDir: string): Path[] {
  const treeRoot = makeTempDir();
  return [
    writeSessionTranscript(treeRoot, SESSION_ONE, [
      buildSessionCwdRecord(diskDir, SESSION_ONE),
      buildSnapshotRecord("shared.txt", "aaa111@v1", 1, SNAPSHOT_ONLY_INSTANT),
      buildSnapshotRecord("shared.txt", "aaa111@v2", 2, new Date(SHARED_FILE_MTIME).toISOString()),
      buildSnapshotRecord("disk-only.txt", "bbb222@v1", 1, new Date(DISK_ONLY_FILE_MTIME).toISOString()),
    ]),
  ];
}

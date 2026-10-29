// Per-file timeline of backup points; provides temporal lookups for sidecar seed selection.
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getFileHistorySnapshot } from "./structures/file-history.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { normalizeAgainstCwd } from "./structures/path-resolve.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";
import { getRecordSource } from "./parse/loadTranscript.ts";

// `line` is absent for fabricated records, which carry no transcript source.
export type BackupPoint = {
  backupTime: Date;
  backupFileName: Path | null;
  sessionId?: Uuid;
  version: number;
  line?: number;
};

// Snapshots lack cwd; find it from the first envelope record that carries one.
export function findCwd(records: TranscriptRecord[]): Path | undefined {
  for (const record of records) {
    const cwd = (record as { cwd?: Path }).cwd;
    if (cwd) {
      return cwd;
    }
  }
  return undefined;
}

// Memoized per (records, cwd): every repair pass re-enters here.
export function buildBackupTimeline(
  records: TranscriptRecord[],
  cwd: Path | undefined,
): Map<string, BackupPoint[]> {
  const timelinesByCwd = getCorpusState(records).backupTimelinesByCwd;
  const cwdKey = cwd === undefined ? "" : cwd.toString();
  const cached = timelinesByCwd.get(cwdKey);
  if (cached !== undefined) {
    return cached;
  }
  const timeline = computeBackupTimeline(records, cwd);
  timelinesByCwd.set(cwdKey, timeline);
  return timeline;
}

function compareBackupTime(a: BackupPoint, b: BackupPoint): number {
  return a.backupTime.getTime() - b.backupTime.getTime();
}

function computeBackupTimeline(
  records: TranscriptRecord[],
  cwd: Path | undefined,
): Map<string, BackupPoint[]> {
  const timeline = new Map<string, BackupPoint[]>();
  // snapshot records carry no sessionId; the owner is the latest envelope sessionId seen so far.
  let session: Uuid | undefined;
  for (const record of records) {
    session = (record as { sessionId?: Uuid }).sessionId ?? session;
    const message = getFileHistorySnapshot(record);
    if (!message) {
      continue;
    }
    const recordLine = getRecordSource(record)?.lineNumber;
    for (const [path, backup] of message.snapshot.trackedFileBackups.listEntries()) {
      const key = normalizeAgainstCwd(cwd, path);
      const points = timeline.get(key) ?? [];
      points.push({
        backupTime: backup.backupTime,
        backupFileName: backup.backupFileName,
        sessionId: session,
        version: backup.version,
        line: recordLine,
      });
      timeline.set(key, points);
    }
  }
  for (const points of timeline.values()) {
    points.sort(compareBackupTime);
  }
  return timeline;
}

// First non-null backup blob of `target` strictly after `when`.
export function findBackupAfter(
  timeline: Map<string, BackupPoint[]>,
  cwd: Path | undefined,
  target: Path,
  when: Date,
): Path | undefined {
  const next = findBackupPointAfter(timeline, cwd, target, when);
  return next?.backupFileName ?? undefined;
}

// Latest non-null backup of `target` at or before `when` (pre-edit seed content).
export function findBackupAtOrBefore(
  timeline: Map<string, BackupPoint[]>,
  cwd: Path | undefined,
  target: Path,
  when: Date,
): BackupPoint | undefined {
  const points = timeline.get(normalizeAgainstCwd(cwd, target)) ?? [];
  let chosen: BackupPoint | undefined;
  const whenMillis = when.getTime();
  for (const point of points) {
    const hasBackup = point.backupFileName !== null;
    const isAtOrBefore = point.backupTime.getTime() <= whenMillis;
    const isCandidate = hasBackup && isAtOrBefore;
    if (isCandidate) {
      chosen = point;
    }
  }
  return chosen;
}

// Like findBackupAfter but returns the full BackupPoint (seed needs backupTime).
export function findBackupPointAfter(
  timeline: Map<string, BackupPoint[]>,
  cwd: Path | undefined,
  target: Path,
  when: Date,
): BackupPoint | undefined {
  const points = timeline.get(normalizeAgainstCwd(cwd, target)) ?? [];
  const whenMillis = when.getTime();
  for (const point of points) {
    const hasBackup = point.backupFileName !== null;
    const isAfter = point.backupTime.getTime() > whenMillis;
    const isCandidate = hasBackup && isAfter;
    if (isCandidate) {
      return point;
    }
  }
  return undefined;
}

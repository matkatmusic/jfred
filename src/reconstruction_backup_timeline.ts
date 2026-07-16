// The per-file timeline of file-history backup points behind the sidecar: which backup blob
// captured each tracked file at which instant, and the lookups (after / at-or-before / point-after)
// the sidecar's synthetic-Write producers select seeds with.
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getFileHistorySnapshot } from "./structures/file-history.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";

export type BackupPoint = { backupTime: Date; backupFileName: Path | null; sessionId?: Uuid };

// The transcript's working directory, used to make the snapshots' cwd-relative paths
// absolute. file-history-snapshot records carry none, so scan for the first record that
// has a cwd (the envelope records do).
export function findCwd(records: TranscriptRecord[]): Path | undefined {
    for (const record of records) {
        const cwd = (record as { cwd?: Path }).cwd;
        if (cwd) {
            return cwd;
        }
    }
    return undefined;
}

// Per absolute path, the time-ordered backup points across every file-history snapshot.
// Memoized per records identity in the corpus (pure group — the snapshots are records, not disk),
// keyed by the cwd the paths were resolved against: every repair pass of every reconstructed file
// re-enters here, and the timeline only depends on (records, cwd).
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
        for (const [path, backup] of message.snapshot.trackedFileBackups.entries()) {
            const key = resolveAgainstCwd(cwd, path);
            const points = timeline.get(key) ?? [];
            points.push({ backupTime: backup.backupTime, backupFileName: backup.backupFileName, sessionId: session });
            timeline.set(key, points);
        }
    }
    for (const points of timeline.values()) {
        points.sort((a, b) => a.backupTime.getTime() - b.backupTime.getTime());
    }
    return timeline;
}

// The blob name of the first snapshot of `target` taken strictly after `when` whose
// backup is non-null (a null backup is version 1, which holds no blob).
export function findBackupAfter(
    timeline: Map<string, BackupPoint[]>,
    cwd: Path | undefined,
    target: Path,
    when: Date,
): Path | undefined {
    const points = timeline.get(resolveAgainstCwd(cwd, target)) ?? [];
    const next = points.find(
        (point) => point.backupFileName !== null && point.backupTime.getTime() > when.getTime(),
    );
    return next?.backupFileName ?? undefined;
}

// The latest backup point of `target` whose backup is non-null and whose snapshot was taken at or
// before `when` — the pre-edit on-disk content for an Edit-first file. Returns the BackupPoint (the
// seed needs its backupTime), or undefined when none precedes the edit.
export function findBackupAtOrBefore(
    timeline: Map<string, BackupPoint[]>,
    cwd: Path | undefined,
    target: Path,
    when: Date,
): BackupPoint | undefined {
    const points = timeline.get(resolveAgainstCwd(cwd, target)) ?? [];
    let chosen: BackupPoint | undefined;
    for (const point of points) {
        if (point.backupFileName !== null && point.backupTime.getTime() <= when.getTime()) {
            chosen = point;
        }
    }
    return chosen;
}

// The first non-null backup point of `target` taken strictly after `when` — the pre-edit content when
// the file-history snapshot capturing it was timestamped just AFTER the edit's tool-use time (m6: a
// user edit and the edit that follows it land in the same turn, so the pre-edit snapshot lands 22ms
// after the edit record). The BackupPoint variant of findBackupAfter (the seed needs its backupTime).
export function findBackupPointAfter(
    timeline: Map<string, BackupPoint[]>,
    cwd: Path | undefined,
    target: Path,
    when: Date,
): BackupPoint | undefined {
    const points = timeline.get(resolveAgainstCwd(cwd, target)) ?? [];
    return points.find(
        (point) => point.backupFileName !== null && point.backupTime.getTime() > when.getTime(),
    );
}

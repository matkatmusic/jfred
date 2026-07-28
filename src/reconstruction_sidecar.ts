// Redirects leave no JSONL content; the reader fetches full content from file-history backup blobs so the engine stays pure.
import type { TranscriptRecord } from "./structures/envelope.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import {
    buildBackupTimeline,
    findBackupAfter,
    findBackupAtOrBefore,
    findBackupPointAfter,
    findCwd,
} from "./reconstruction_backup_timeline.ts";
import type { FileEvent, WriteEvent } from "./reconstruction_engine.ts";

// sessionId names the owning file-history dir: a merged multi-session transcript reuses `@vN` blob names.
export type BackupReader = (backupFileName: Path, sessionId?: Uuid) => string;

// Spec 39: an edit-first Write is abandoned, so a synthetic backup Write lets the edit splice onto real content.
export function seedEditBaseFromBackup(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
): FileEvent[] {
    const first = events[0];
    if (first === undefined || first.kind !== EventKind.edit) {
        return events;
    }
    const seed = backupSeedWriteFor(records, first.target, first.timestamp, reader);
    if (seed) {
        noteStage({ stage: "seedEditBaseFromBackup", target: first.target, changeId: first.changeId, detail: "seeded an edit-first file's pre-edit content from backup", when: seed.timestamp });
    }
    return seed ? [seed, ...events] : events;
}

// Undefined when no backup precedes `when`; changeId is the blob name, keeping spec 40's base on the REAL Write.
export function backupSeedWriteFor(
    records: TranscriptRecord[],
    target: Path,
    when: Date,
    reader: BackupReader,
    includeAfter: boolean = false,
): WriteEvent | undefined {
    const cwd = findCwd(records);
    const timeline = buildBackupTimeline(records, cwd);
    const atOrBefore = findBackupAtOrBefore(timeline, cwd, target, when);
    const base =
        atOrBefore ?? (includeAfter ? findBackupPointAfter(timeline, cwd, target, when) : undefined);
    if (base === undefined || base.backupFileName === null) {
        return undefined;
    }
    return {
        kind: EventKind.write,
        changeId: new Uuid(base.backupFileName.toString()),
        target,
        content: reader(base.backupFileName, base.sessionId),
        timestamp: base.backupTime,
    };
}

// Clamps a backup-stamped seed between the previous point and its edit so the timestamp ladder never goes backwards.
export function clampSeedBetweenPreviousAndEdit(
    seed: WriteEvent,
    editTime: Date,
    previousTime: Date | undefined,
): WriteEvent {
    const latestAllowed = editTime.getTime() - 1;
    const earliestAllowed = previousTime === undefined ? seed.timestamp.getTime() : previousTime.getTime();
    const placed = Math.min(Math.max(seed.timestamp.getTime(), earliestAllowed), latestAllowed);
    if (placed === seed.timestamp.getTime()) {
        return seed;
    }
    return { ...seed, timestamp: new Date(placed) };
}

// Recovers an edit's pre-edit base from the post-edit backup when no at-or-before content exists (s28 scoped renames).
export function backupAfterWriteFor(
    records: TranscriptRecord[],
    target: Path,
    when: Date,
    reader: BackupReader,
): WriteEvent | undefined {
    const cwd = findCwd(records);
    const timeline = buildBackupTimeline(records, cwd);
    const after = findBackupPointAfter(timeline, cwd, target, when);
    if (after === undefined || after.backupFileName === null) {
        return undefined;
    }
    return {
        kind: EventKind.write,
        changeId: new Uuid(after.backupFileName.toString()),
        target,
        content: reader(after.backupFileName, after.sessionId),
        timestamp: after.backupTime,
    };
}

// Time-ascending: the version matching an ELIDED beacon isn't always latest, so callers must validate by content (s28).
export function backupWritesFor(
    records: TranscriptRecord[],
    target: Path,
    reader: BackupReader,
): WriteEvent[] {
    const cwd = findCwd(records);
    const timeline = buildBackupTimeline(records, cwd);
    const points = timeline.get(resolveAgainstCwd(cwd, target)) ?? [];
    const writes: WriteEvent[] = [];
    for (const point of points) {
        if (point.backupFileName === null) {
            continue;
        }
        writes.push({
            kind: EventKind.write,
            changeId: new Uuid(point.backupFileName.toString()),
            target,
            content: reader(point.backupFileName, point.sessionId),
            timestamp: point.backupTime,
        });
    }
    return writes;
}

// Completes a TERMINAL truncated user-edit beacon (s27) using the newest point, sidestepping m6's ms-timing fragility.
export function latestBackupWriteFor(
    records: TranscriptRecord[],
    target: Path,
    reader: BackupReader,
): WriteEvent | undefined {
    const writes = backupWritesFor(records, target, reader); // time-ascending; newest is last
    return writes[writes.length - 1];
}

// A redirect with no resolvable backup keeps its empty content, defensive since a tracked file should always resolve.
export function fillRedirectContent(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
): FileEvent[] {
    const cwd = findCwd(records);
    const timeline = buildBackupTimeline(records, cwd);
    return events.map((event) => {
        if (event.kind !== EventKind.append && event.kind !== EventKind.overwrite) {
            return event;
        }
        const backupFileName = findBackupAfter(timeline, cwd, event.target, event.timestamp);
        if (!backupFileName) {
            return event;
        }
        noteStage({ stage: "fillRedirectContent", target: event.target, changeId: event.changeId, detail: `filled ${event.kind} content from the file-history backup` });
        return { ...event, content: reader(backupFileName) };
    });
}


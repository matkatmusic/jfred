// Sidecar: a `>`/`>>` redirect leaves no content in the JSONL, but the snapshot taken next after it
// names the backup blob holding the file's full new content. Blobs live at
// <root>/<sessionId>/<backupFileName>, which already embeds hash@vN, so no hashing is needed.
// The reader is injected so the engine stays pure and tests use an in-memory map.
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

// An edit-first file's creating Write lives on an abandoned branch (spec 39), so a synthetic Write
// from the backup at or before the edit is prepended to give the edit real lines to splice onto.
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

// Undefined when no backup blob precedes `when` (version 1 holds no blob). The changeId is the blob
// name, keeping the synthetic seed out of the graphs — spec 40 attributes a base to the REAL Write.
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

// backupSeedWriteFor stamps a seed with the BACKUP's own instant, which can fall at/after the edit
// (s64, s19/s23/m6) or before a mid-window `--base-commit` beacon (task 224); clamping both ends
// keeps the ladder non-decreasing. With no valid slot, "a seed precedes the edit it seeds" wins.
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

// Reverses an edit to recover its pre-edit base when the sidecar holds no at-or-before full content
// (s28: a scoped rename leaves no per-file Write, so the post-edit backup is the only full content).
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

// Time-ascending, because the version matching an ELIDED beacon is NOT necessarily the latest (a
// later Edit produces a newer blob) — the caller must scan versions and validate by content (s28).
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

// Completes a TERMINAL truncated user-edit beacon (s27). Selecting the newest non-null point rather
// than a timestamp-relative one sidesteps m6's ms-timing fragility.
export function latestBackupWriteFor(
    records: TranscriptRecord[],
    target: Path,
    reader: BackupReader,
): WriteEvent | undefined {
    const writes = backupWritesFor(records, target, reader); // time-ascending; newest is last
    return writes[writes.length - 1];
}

// A redirect with no resolvable backup keeps its empty content — defensive, and should not happen
// for a tracked file.
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


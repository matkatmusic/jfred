// Sidecar: recover a bash redirect's resulting file content from the file-history backups
// beside the transcript. A `>`/`>>` leaves no content in the JSONL, but Claude Code snapshots
// each tracked file just after a turn; the snapshot taken next after the redirect names the
// backup blob holding the file's full new content. Blobs live at
// <root>/<sessionId>/<backupFileName>; backupFileName already embeds hash@vN, so no hashing.
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

// When a file's first event on this branch is an Edit (its creating Write lives on an abandoned
// conversation branch and a conversation-only rewind left the file on disk — spec 39), recover the
// pre-edit on-disk content from the file-history backup taken at or before the edit and prepend a
// synthetic Write so the edit splices onto real lines. A file whose first event already creates it
// (write/overwrite/copy/append) is returned unchanged.
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

// A synthetic Write that seeds `target`'s pre-edit on-disk content from the file-history backup taken
// at or before `when` — the source of truth for content an off-branch edit left on disk. Returns
// undefined when no backup blob precedes `when` (version 1 holds no blob). The changeId is the backup
// blob name, so the synthetic seed stays out of the graphs (spec 40 attributes a file's base to the
// REAL Write turn).
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

// A seed spliced before an EDIT has to sort into the window between the event it is pushed after and
// that edit. `backupSeedWriteFor` stamps it with the BACKUP's own instant, which answers to neither
// bound: it can land at/after the edit (a post-/clear edit whose only base backup was taken later —
// s64; an includeAfter backup — s19/s23/m6), and, once a mid-window `--base-commit` beacon precedes it,
// BEFORE that beacon (task 224). Clamping both ends keeps the replayed ladder non-decreasing. A seed
// already inside its window is returned untouched, so every ladder monotonic today is byte-for-byte
// unaffected. When `previousTime` is already at/after the edit no valid slot exists — the events were
// non-monotonic BEFORE this seed — and the load-bearing "a seed precedes the edit it seeds" rule wins.
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

// A synthetic Write of `target`'s content from the FIRST file-history backup taken strictly AFTER
// `when`. The source for reversing an edit to recover its pre-edit base when the sidecar holds no
// at-or-before full content (s28: a scoped rename leaves no per-file Write, so catalog_view.py's only
// full content is the post-preview-edit backup). undefined when no later backup blob exists.
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

// Every non-null file-history backup of `target` as a synthetic Write, time-ascending. Used to find
// the backup version whose numbered content matches an ELIDED beacon (s28): the correct post-script
// version is NOT necessarily the latest (a later Edit produces a newer blob), so the caller must scan
// versions and validate by content. changeId = the blob name (out of the graphs, spec 40).
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

// A synthetic Write seeding `target`'s FINAL on-disk content from its LATEST file-history backup blob
// (the highest version — a post-script snapshot can land a few ms after the beacon, m6). Used to
// complete a TERMINAL user-edit beacon the harness truncated (s27). Selecting the newest non-null
// point — rather than a timestamp-relative one — robustly picks the complete post-script version and
// sidesteps the m6-style ms-timing fragility. The changeId is the blob name, keeping the synthetic
// seed out of the graphs (spec 40). Returns undefined when the file has no backup blob.
export function latestBackupWriteFor(
    records: TranscriptRecord[],
    target: Path,
    reader: BackupReader,
): WriteEvent | undefined {
    const writes = backupWritesFor(records, target, reader); // time-ascending; newest is last
    return writes[writes.length - 1];
}

// Fill each append/overwrite event's content from the sidecar; pass others through. A
// redirect with no resolvable backup keeps its empty content (defensive — should not happen
// for a tracked file).
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


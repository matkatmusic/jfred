// Complete truncated (s27) and elided (s28) beacons via sidecar backups.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { backupWritesFor, latestBackupWriteFor } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import { beaconSnippetFor } from "./reconstruction_user_edit.ts";
import type { BeaconSnippet } from "./reconstruction_user_edit.ts";
import type { FileEvent, UserEditEvent, WriteEvent } from "./reconstruction_engine.ts";

// --- terminal truncated beacons (s27) --------------------------------------------------------------

// Line-count gate excludes trailing-newline-only diffs; startsWith rejects poison backups.
function beaconIsTruncated(beacon: UserEditEvent, backupContent: string): boolean {
    return (
        backupContent.startsWith(beacon.content) &&
        splitLines(backupContent).length > splitLines(beacon.content).length
    );
}

// s27: append a backup Write when the terminal beacon was truncated, so replay ends with complete content.
export function completeTruncatedBeacon(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
): FileEvent[] {
    const last = events[events.length - 1];
    if (last === undefined || last.kind !== EventKind.userEdit) {
        return events;
    }
    const seed = latestBackupWriteFor(records, last.target, reader);
    if (seed === undefined || !beaconIsTruncated(last, seed.content)) {
        return events;
    }
    noteStage({
        stage: "completeTruncatedBeacon",
        target: last.target,
        changeId: last.changeId,
        detail: "appended a synthetic Write completing a truncated terminal user-edit beacon",
        when: seed.timestamp,
    });
    return [...events, seed];
}

// --- elided beacons (s28) --------------------------------------------------------------------------

// Detects windowed snippets (s28); pure tail-truncation is left to completeTruncatedBeacon (s27).
function beaconIsElided(snippet: BeaconSnippet): boolean {
    const first = snippet.lines[0];
    if (first === undefined) {
        return false;
    }
    if (snippet.hasEllipsis || first.lineNo > 1) {
        return true;
    }
    for (let index = 1; index < snippet.lines.length; index += 1) {
        if (snippet.lines[index]!.lineNo !== snippet.lines[index - 1]!.lineNo + 1) {
            return true;
        }
    }
    return false;
}

// Forward-validates backup by matching every visible beacon line at its line number; rejects mismatches.
function backupMatchesBeacon(snippet: BeaconSnippet, backupContent: string): boolean {
    const lines = splitLines(backupContent);
    if (lines.length <= snippet.lines.length) {
        return false;
    }
    for (const { lineNo, text } of snippet.lines) {
        if (lineNo - 1 >= lines.length || lines[lineNo - 1] !== text) {
            return false;
        }
    }
    return true;
}

// Rejects backups newer than the next lineage event to exclude later edits' effects.
function backupIsWithinBound(candidate: WriteEvent, notAfter: Date | undefined): boolean {
    if (notAfter === undefined) {
        return true;
    }
    return candidate.timestamp.getTime() <= notAfter.getTime();
}

// Midpoint between last backup without and first backup with the content; brackets the real edit time.
function bracketMidpointTime(seed: WriteEvent, backups: WriteEvent[]): Date {
    const firstWith = backups.find((backup) => backup.content === seed.content) ?? seed;
    let lastWithout: WriteEvent | undefined;
    for (const backup of backups) {
        if (backup.timestamp.getTime() < firstWith.timestamp.getTime() && backup.content !== seed.content) {
            lastWithout = backup;
        }
    }
    if (lastWithout === undefined) {
        return seed.timestamp;
    }
    return new Date((lastWithout.timestamp.getTime() + firstWith.timestamp.getTime()) / 2);
}

// Latest in-bound backup matching an elided beacon's visible lines, retimed to the bracket midpoint.
function elidedBeaconSeed(
    records: TranscriptRecord[],
    beacon: UserEditEvent,
    reader: BackupReader,
    notAfter: Date | undefined,
    lineage: FileEvent[],
): WriteEvent | undefined {
    const snippet = beaconSnippetFor(records, beacon.changeId);
    if (snippet === undefined || !beaconIsElided(snippet)) {
        return undefined;
    }
    const backups = backupWritesFor(records, beacon.target, reader);
    let match: WriteEvent | undefined;
    for (const candidate of backups) {
        if (!backupIsWithinBound(candidate, notAfter)) {
            continue;
        }
        if (backupMatchesBeacon(snippet, candidate.content)) {
            match = candidate; // time-ascending; keep the latest in-bound version consistent with the window
        }
    }
    if (match === undefined) {
        return undefined;
    }
    // Only retime terminal beacons to the bracket midpoint; skip if a real edit sits between.
    const midpoint = bracketMidpointTime(match, backups);
    const crossesEdit = lineage.some(
        (event) =>
            event !== beacon &&
            event.timestamp.getTime() > midpoint.getTime() &&
            event.timestamp.getTime() < beacon.timestamp.getTime(),
    );
    if (notAfter !== undefined || midpoint.getTime() >= beacon.timestamp.getTime() || crossesEdit) {
        return match;
    }
    return { ...match, timestamp: midpoint };
}

// Record that an elided-beacon completion fired, tagging the beacon (its changeId) and the backup time used.
function noteElidedSeed(beacon: UserEditEvent, seed: WriteEvent): void {
    noteStage({
        stage: "completeElidedBeacons",
        target: beacon.target,
        changeId: beacon.changeId,
        detail: "spliced a synthetic Write completing an elided (windowed) user-edit beacon",
        when: seed.timestamp,
    });
}

// Splice a backup Write after each elided beacon so later Edits apply to complete content.
export function completeElidedBeacons(
    records: TranscriptRecord[],
    events: FileEvent[],
    reader: BackupReader,
): FileEvent[] {
    const result: FileEvent[] = [];
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index]!;
        if (event.kind !== EventKind.userEdit) {
            result.push(event);
            continue;
        }
        const seed = elidedBeaconSeed(records, event, reader, events[index + 1]?.timestamp, events);
        if (seed === undefined) {
            result.push(event);
            continue;
        }
        // Retime a stale-echo beacon to the seed's instant so windowed content does not mask it.
        const beacon = seed.timestamp.getTime() < event.timestamp.getTime() ? { ...event, timestamp: seed.timestamp } : event;
        noteElidedSeed(event, seed);
        result.push(beacon);
        result.push(seed);
    }
    return result;
}



// Backup-driven beacon-completion transforms: rewrite a file's reconstructed event list using content
// recovered from the file-history sidecar, BEFORE replay, to COMPLETE a user-edit beacon the harness only
// partially echoed. Both families are reader-only (the caller guards on `reader`, so reader-free
// reconstruction is byte-for-byte untouched):
//   - completeTruncatedBeacon: append a synthetic Write completing a TERMINAL user-edit beacon the
//     harness truncated (s27 — a script rewrote the file and the post-script edited_text_file snippet
//     is only a prefix of the new content, with NO later Edit to reseed against).
//   - completeElidedBeacons: splice a synthetic Write after EACH ELIDED user-edit beacon (s28 — a
//     scoped script rename whose post-script edited_text_file snippet is only a WINDOW onto the new
//     content: head/tail/interior lines omitted, detected from the snippet's line numbers). The backup
//     version is chosen by CONTENT (forward-validation), not recency. Disjoint from completeTruncated-
//     Beacon: a pure terminal tail-truncation (contiguous-from-1 prefix) is NOT elided.
// (Split out of reconstruction_reseed.ts to keep both files within the 250-line cap — split, never
// condense; the stale-edit-base family stays in reconstruction_reseed.ts.) Design:
// plans/s27/s27-reconstruction-plan.md §3, plans/s28/s28-reconstruction-plan.md §3.

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

// A terminal user-edit beacon is TRUNCATED when its snippet is a byte-prefix of the file's final
// backup AND the backup has strictly more lines. The line-count test (splitLines drops a single
// trailing newline) means a backup that differs from the beacon only by a trailing newline — the
// common COMPLETE-beacon case — is NOT treated as truncated, so complete beacons pass through
// untouched. The `startsWith` half also makes a poison/garbage backup a no-op.
function beaconIsTruncated(beacon: UserEditEvent, backupContent: string): boolean {
    return (
        backupContent.startsWith(beacon.content) &&
        splitLines(backupContent).length > splitLines(beacon.content).length
    );
}

// When a file's LAST event is a user-edit beacon the harness truncated (s27: a script rewrote the
// file and the post-script `edited_text_file` snippet is only a prefix of the new content, with NO
// later Edit to reseed against), append a synthetic Write from the latest file-history backup so
// replay's terminal revision is the COMPLETE file (an overwrite), not the truncated snippet. Files
// whose last event is not a user-edit, or whose beacon is already complete, are returned unchanged.
// Reader-only — without a backup the file stays truncated (reader-dependent, like s25's geo_report).
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

// A user-edit beacon is ELIDED (a WINDOWED `edited_text_file` view — s28's scoped script rename) when
// its `cat -n` snippet omits lines: it starts past line 1 (head elided), has a gap between consecutive
// line numbers (interior elided), or carries a literal `...` separator. A snippet that starts at line 1
// with contiguous numbers and no `...` is NOT elided here — a pure terminal tail-truncation is left to
// completeTruncatedBeacon (s27), keeping the two triggers disjoint.
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

// Forward-validation: whether `backupContent` reproduces EVERY visible line of an elided beacon at its
// own line number, and holds more lines than the beacon showed. A backup that fails any visible line is
// rejected (never fabricate) — this is how the right post-script version is picked among all backups
// and how a poison/wrong backup is made a no-op.
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

// Whether a candidate backup was taken at or before `notAfter` — the timestamp of the lineage event
// that FOLLOWS the beacon. A beacon's completed content can never be newer than the next thing that
// happened to the file, so a backup carrying a LATER edit's effect (s45: the restore echo's `add`-tail
// window also matches the post-`multiply` backup) is excluded. undefined `notAfter` (a terminal beacon
// — s28's case) imposes no bound, so existing behaviour is unchanged.
function backupIsWithinBound(candidate: WriteEvent, notAfter: Date | undefined): boolean {
    if (notAfter === undefined) {
        return true;
    }
    return candidate.timestamp.getTime() <= notAfter.getTime();
}

// The instant a backup-completed user edit most likely landed: the midpoint between the latest backup
// that still lacks the completed content and the earliest backup that carries it — the tightest bracket
// the file's OWN snapshots provide. A beacon echoed only at an agent's closeout (s62: orders.py goes
// quiet after its last edit, so its sole echo lands ~20s late, past the window where a concurrent sibling
// file still matches its step) would otherwise be dated at that far-off echo/backup time. The bracket
// midpoint lands inside the real edit window without needing the instruction order. Falls back to the
// seed's own backup time when no earlier differing backup exists (single-session beacons — s28/s30/s35).
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

// The synthetic Write completing an ELIDED beacon: the latest file-history backup (taken no later than
// the next lineage event) whose numbered content matches every visible beacon line, re-timed to the
// bracket midpoint (when the edit most likely landed) rather than the late backup snapshot. undefined
// when the beacon is not elided or no backup matches (reader-only; never fabricated).
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
    // Only a TERMINAL beacon (no later lineage event) can be a closeout-stale echo dated long after the
    // edit; a mid-stream beacon's echo already sits near the real edit. Even then, only pull it back to the
    // bracket midpoint if no real same-file edit sits between — else the retimed completion would land
    // before that edit, which then reverts it (s56: a windowed echo following a tracked edit).
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

// For each ELIDED user-edit beacon (s28: a script rewrote the file and the post-script
// `edited_text_file` snippet is only a WINDOW onto the new content — omitting head/tail/interior
// lines), splice a synthetic Write of the matching file-history backup immediately AFTER the beacon, so
// replay's revision there is the COMPLETE post-script file and any later Edits splice onto the real
// content rather than the window. Reader-only; a beacon with no matching backup is left unchanged.
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
        // When the seed was pulled EARLIER than the beacon's echo (a terminal closeout-stale beacon),
        // move the beacon to that instant too: left at its late echo time, its WINDOWED content would be
        // the file's latest revision after the (now earlier) seed, masking it. Otherwise leave it put.
        const beacon = seed.timestamp.getTime() < event.timestamp.getTime() ? { ...event, timestamp: seed.timestamp } : event;
        noteElidedSeed(event, seed);
        result.push(beacon);
        result.push(seed);
    }
    return result;
}


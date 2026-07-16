// Backup-driven event-list transforms for the STALE-EDIT-BASE family: rewrite a file's reconstructed
// event list using content recovered from the file-history sidecar, BEFORE replay. Reader-only (the
// caller guards on `reader`, so reader-free reconstruction is byte-for-byte untouched):
//   - seedStaleEditBases: splice a synthetic Write before a MID-stream Edit whose reconstructed base
//     drifted from the disk it was computed against. Two disjoint triggers:
//       * a STALE hunk-context base (spec 39 generalised to s19/s23/m6) — the edit's hunk context no
//         longer matches the reconstructed base, so it would splice onto wrong lines; or
//       * an OUT-OF-WINDOW uncaptured manual change (s34) — the hunk context still matches, but the real
//         pre-edit disk carried a trailing append (NO beacon, NO tool_use) outside the hunk window,
//         recovered by content from the at/before backup and forward-validated (never fabricated).
// The beacon-completion family (completeTruncatedBeacon / completeElidedBeacons, s27/s28) lives in
// reconstruction_beacons.ts — split, never condense, to keep both files within the 250-line cap.
// Design: plans/s27/…, plans/s28/…, plans/s34/s34-reconstruction-plan.md §"The fix".

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { replayEvents } from "./reconstruction_replay.ts";
import { lastLinesOf, splitLines, reverseEditFromAfter } from "./reconstruction_replay_edit.ts";
import { backupSeedWriteFor, backupAfterWriteFor } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import type { EditEvent, FileEvent, WriteEvent } from "./reconstruction_engine.ts";

// --- stale mid-stream edit bases (s19 / s23) -------------------------------------------------------

// The reconstructed base text (each line's latest value) the events before an edit produce.
function reconstructedBaseText(priorEvents: FileEvent[]): string[] {
    return lastLinesOf(replayEvents(priorEvents)).map(
        (entry) => entry.values[entry.values.length - 1]!.line,
    );
}

// Whether an edit's first hunk splices cleanly onto `base`: each context/removed line must equal the base
// line at its position; a mismatch — or a position past the base — means it lands on wrong lines. Shared
// by editBaseIsStale (the hunk-context staleness test) and outOfWindowEditSeed (forward-validation that a
// candidate backup is the real pre-edit disk state, not a poison/wrong blob).
function firstHunkMatchesBase(event: EditEvent, base: string[]): boolean {
    const firstHunk = event.hunks[0];
    if (firstHunk === undefined) {
        return true;
    }
    let index = firstHunk.oldStart - 1;
    for (const line of firstHunk.lines) {
        if (line.startsWith("+")) {
            continue;
        }
        if (index >= base.length || base[index] !== line.slice(1)) {
            return false;
        }
        index += 1;
    }
    return true;
}

// Whether an edit's first hunk references base content the events before it did NOT reconstruct: the hunk
// splices onto wrong lines, so the base is reseeded from the backup. Generalises s19 (base too SHORT) to
// s23 (a user edit absorbed only into the post-code-rewind backup; same length).
function editBaseIsStale(event: EditEvent, priorEvents: FileEvent[]): boolean {
    return !firstHunkMatchesBase(event, reconstructedBaseText(priorEvents));
}

// The latest timestamp among `priorEvents` that touch `target` — the moment of the last state the engine
// already captured for the file. undefined when the file has no prior event on this lineage.
function lastPriorTimeFor(target: Path, priorEvents: FileEvent[]): Date | undefined {
    let latest: Date | undefined;
    for (const event of priorEvents) {
        if (!("target" in event) || event.target.toString() !== target.toString()) {
            continue;
        }
        if (latest === undefined || event.timestamp.getTime() > latest.getTime()) {
            latest = event.timestamp;
        }
    }
    return latest;
}

// A synthetic Write of an edit's literal pre-edit content (its result's `originalFile`), or undefined when
// the result omitted it. This is the exact pre-edit disk — used to recover an out-of-hunk-window trailing
// append the reconstructed base missed (s40: the user's "# reviewed by ops" line). The changeId is
// synthetic so the seed stays out of the graphs (spec 40); the timestamp is the edit's, which
// seedBeforeEdit pulls to just before the edit when this seed is used.
// The changeId prefix stamped onto an `originalFile` reseed Write (see originalFileSeedFor). Synthetic,
// so the seed stays out of the graphs; exported so consumers that must UN-wrap it back to the real edit
// changeId (reconstruction_json's session attribution) share this one literal.
export const ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX = "originalFile:";

function originalFileSeedFor(event: EditEvent): WriteEvent | undefined {
    // `== null` catches both the absent field (scenarios) and a literal null (real Edit results record
    // originalFile as null when there is no pre-edit content); either way there is nothing to seed from,
    // so return undefined rather than build a seed with null content (which crashes splitLines).
    if (event.originalFile == null) {
        return undefined;
    }
    return {
        kind: EventKind.write,
        changeId: new Uuid(`${ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX}${event.changeId}`),
        target: event.target,
        content: event.originalFile,
        timestamp: event.timestamp,
    };
}

// s34: an Edit whose hunk context matches the reconstructed base (so editBaseIsStale is FALSE) but whose
// real pre-edit disk state carried an UNCAPTURED manual change OUTSIDE the hunk window (a trailing append
// left no `edited_text_file` beacon and no tool_use). The drift is invisible to the hunk-context test, so
// detect it by content: a file-history backup taken AFTER the last captured event yet AT/BEFORE the edit,
// whose content differs from the reconstructed base AND onto which the hunk still splices cleanly
// (forward-validation — a wrong/poison backup is rejected, never fabricated). Returns that backup as the
// synthetic reseed Write, else undefined.
function outOfWindowEditSeed(
    records: TranscriptRecord[],
    event: EditEvent,
    priorEvents: FileEvent[],
    reader: BackupReader,
): WriteEvent | undefined {
    const base = reconstructedBaseText(priorEvents);
    // Two sources for the real pre-edit disk, each forward-validated the same way (the candidate must
    // EXTEND the reconstructed base by a trailing append — base is its prefix — AND the hunk must still
    // splice cleanly; a mid-file divergence is a STALE older version, s70, and is rejected, never
    // fabricated). The at/before file-history backup (s34: the uncaptured append predates the edit), then
    // the edit's OWN `originalFile` — the literal pre-edit content (s40: the user's "# reviewed by ops"
    // append was snapshotted 46ms AFTER the subtotal Edit, so no at/before backup holds it, but the edit
    // result records the exact pre-edit file). originalFile is exact, so it cannot false-match a later
    // backup the way a strictly-after backup would. seedBeforeEdit re-times the seed to just before the
    // edit, so the recovered append becomes its own revision (s40 step-4) and the edit replays on it (step-5).
    const backup = backupSeedWriteFor(records, event.target, event.timestamp, reader);
    const original = originalFileSeedFor(event);
    for (const seed of [backup, original]) {
        if (seed === undefined) {
            continue;
        }
        const lastPrior = lastPriorTimeFor(event.target, priorEvents);
        if (lastPrior !== undefined && seed.timestamp.getTime() <= lastPrior.getTime()) {
            continue;
        }
        const seedLines = splitLines(seed.content);
        const extendsBase = seedLines.length > base.length && base.every((line, index) => line === seedLines[index]);
        if (extendsBase && firstHunkMatchesBase(event, seedLines)) {
            return seed;
        }
    }
    return undefined;
}

// The pre-edit base recovered by reversing `event` off its after-backup, forward-validated: the reversed
// base must be a clean splice target for the edit's first hunk, else the after-backup is the wrong blob and
// we fall through. Recovers s28's renamed-no-preview catalog_view.py, which exists in no standalone backup
// (the at-or-before backup is the pre-rename version, and the only full post-rename content is the
// after-backup carrying the preview Edit). Reader-only; never fabricated.
function reversedEditBaseSeed(
    records: TranscriptRecord[],
    event: EditEvent,
    reader: BackupReader,
): WriteEvent | undefined {
    const after = backupAfterWriteFor(records, event.target, event.timestamp, reader);
    if (after === undefined) {
        return undefined;
    }
    const reversed = reverseEditFromAfter(splitLines(after.content), event);
    if (reversed === undefined || !firstHunkMatchesBase(event, reversed)) {
        return undefined;
    }
    // Reverse only when an at-or-before backup ALSO exists but holds DIFFERENT content than the reversed
    // base — the rename-between-backups signature unique to s28 (at/before is the stale pre-rename version,
    // and reversing the after-backup recovers the renamed-no-preview base it lacks). When no at/before
    // backup exists, the old after-fallback already yields the right base (s25/m6 geo_report), so leave it.
    const reversedContent = reversed.join("\n") + "\n";
    const atOrBefore = backupSeedWriteFor(records, event.target, event.timestamp, reader);
    if (atOrBefore === undefined || atOrBefore.content === reversedContent) {
        return undefined;
    }
    return { ...after, content: reversedContent };
}

// The synthetic backup-seed Write to splice before `event`, or undefined when its base is intact (the
// common case — every edit whose reconstructed base already matches the disk it was computed against). Two
// disjoint triggers: a stale hunk-context base (s19/s23/m6 — reseed from the at/before-or-after backup), or
// an out-of-window uncaptured manual change with a clean hunk context (s34 — reseed from the at/before
// backup, content-validated).
function staleEditSeedFor(
    records: TranscriptRecord[],
    event: FileEvent,
    priorEvents: FileEvent[],
    reader: BackupReader,
): WriteEvent | undefined {
    if (event.kind !== EventKind.edit) {
        return undefined;
    }
    if (editBaseIsStale(event, priorEvents)) {
        return reversedEditBaseSeed(records, event, reader)                              // s28
            ?? backupSeedWriteFor(records, event.target, event.timestamp, reader, true); // s19/s23/m6
    }
    return outOfWindowEditSeed(records, event, priorEvents, reader); // s34
}

// A seed spliced BEFORE an edit is that edit's PRE-edit base, so it must sort before the edit on the
// timeline. The backup it was recovered from can carry a timestamp at/after the edit — e.g. a post-/clear
// edit (s64) whose only base backup was taken later, or an includeAfter backup (s19/s23/m6). When it does,
// pull the seed to just before the edit so the per-step timeline shows the base THEN the edited state, not
// only the edited one (lastRevisionAtOrBefore would otherwise resolve both steps to the edited revision).
// Backups already earlier than the edit (s19/s23/s34/s45) are left untouched.
function seedBeforeEdit(seed: WriteEvent, event: FileEvent): WriteEvent {
    if (seed.timestamp.getTime() < event.timestamp.getTime()) {
        return seed;
    }
    return { ...seed, timestamp: new Date(event.timestamp.getTime() - 1) };
}

// Record that a stale-edit-base reseed fired, tagging the edit it seeds (its changeId is the producing
// record) and the backup time used.
function noteStaleSeed(event: FileEvent, seed: WriteEvent): void {
    noteStage({
        stage: "seedStaleEditBases",
        target: seed.target,
        changeId: event.kind === EventKind.edit ? event.changeId : seed.changeId,
        detail: "reseeded a stale mid-stream edit base from the file-history backup",
        when: seed.timestamp,
    });
}

// Generalises spec 39's edit-base seeding to MID-stream edits: walk the lineage and, before each edit
// whose base is stale (off-branch changes persisted across a rewind — s19), splice the synthetic
// backup-seed Write so the hunk's context lands on the real pre-edit disk content. Edits whose base is
// intact pass through unchanged, so every pre-s19 scenario is byte-for-byte unaffected.
export function seedStaleEditBases(
    records: TranscriptRecord[],
    lineage: FileEvent[],
    reader: BackupReader,
): FileEvent[] {
    const result: FileEvent[] = [];
    for (const event of lineage) {
        const rawSeed = staleEditSeedFor(records, event, result, reader);
        if (rawSeed) {
            const seed = seedBeforeEdit(rawSeed, event);
            noteStaleSeed(event, seed);
            result.push(seed);
        }
        result.push(event);
    }
    return result;
}


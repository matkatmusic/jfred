// Backup-driven event-list transforms for the STALE-EDIT-BASE family: splice a synthetic Write before
// a mid-stream Edit whose reconstructed base drifted from the disk it was computed against. Reader-only,
// so reader-free reconstruction is byte-for-byte untouched. Design: plans/s34/s34-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Path } from "./structures/domain.ts";
import { Uuid } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { replayEvents } from "./reconstruction_replay.ts";
import { lastLinesOf, splitLines, reverseEditFromAfter } from "./reconstruction_replay_edit.ts";
import { backupSeedWriteFor, backupAfterWriteFor, clampSeedBetweenPreviousAndEdit } from "./reconstruction_sidecar.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { noteStage } from "./reconstruction_provenance.ts";
import type { EditEvent, FileEvent, WriteEvent } from "./reconstruction_engine.ts";


function reconstructedBaseText(priorEvents: FileEvent[]): string[] {
    return lastLinesOf(replayEvents(priorEvents)).map(
        (entry) => entry.values[entry.values.length - 1]!.line,
    );
}

// A mismatch — or a position past the base — means the hunk would land on wrong lines; also used as
// forward-validation that a candidate backup is the real pre-edit disk, not a poison blob.
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

// Generalises s19 (base too SHORT) to s23 (a user edit absorbed only into the post-rewind backup).
function editBaseIsStale(event: EditEvent, priorEvents: FileEvent[]): boolean {
    return !firstHunkMatchesBase(event, reconstructedBaseText(priorEvents));
}

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

// Synthetic prefix keeps an `originalFile` reseed Write out of the graphs; exported so consumers that
// un-wrap it back to the real edit changeId (session attribution) share this one literal.
export const ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX = "originalFile:";

function originalFileSeedFor(event: EditEvent): WriteEvent | undefined {
    // `== null` catches both the absent field and a literal null; a seed with null content crashes splitLines.
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

// s34: an uncaptured manual change OUTSIDE the hunk window is invisible to the hunk-context test, so it
// is detected by content and forward-validated — a wrong/poison backup is rejected, never fabricated.
function outOfWindowEditSeed(
    records: TranscriptRecord[],
    event: EditEvent,
    priorEvents: FileEvent[],
    reader: BackupReader,
): WriteEvent | undefined {
    const base = reconstructedBaseText(priorEvents);
    // Both candidates must EXTEND the base by a trailing append AND still splice cleanly; a mid-file
    // divergence is a stale older version (s70) and is rejected. The at/before backup covers s34; the
    // edit's own `originalFile` covers s40, where the append was snapshotted after the Edit.
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

// Recovers s28's renamed-no-preview base, which exists in no standalone backup; the reversed base must
// splice cleanly or the after-backup is the wrong blob and we fall through.
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
            // task 224: the seed must sort into the window between the event it is pushed after and the
            // edit it seeds — the recovered backup's own stamp can sit outside BOTH ends.
            const seed = clampSeedBetweenPreviousAndEdit(rawSeed, event.timestamp, result[result.length - 1]?.timestamp);
            noteStaleSeed(event, seed);
            result.push(seed);
        }
        result.push(event);
    }
    return result;
}


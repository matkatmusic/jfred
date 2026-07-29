// Backup-driven event-list transforms for the STALE-EDIT-BASE family: reader-only, so reader-free reconstruction stays byte-for-byte untouched. Design: plans/s34/s34-reconstruction-plan.md.

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

// A mismatch means the hunk lands on wrong lines; also validates a candidate backup is real pre-edit disk, not poison.
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

// Synthetic prefix keeps `originalFile` reseed Writes out of the graphs; exported so consumers can un-wrap it to the real changeId.
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

// s34: a manual change outside the hunk window is invisible to the hunk-context test, so it's detected by content instead.
function outOfWindowEditSeed(
    records: TranscriptRecord[],
    event: EditEvent,
    priorEvents: FileEvent[],
    reader: BackupReader,
): WriteEvent | undefined {
    const base = reconstructedBaseText(priorEvents);
    // Both candidates must extend the base by a trailing append and splice cleanly; a mid-file divergence (s70) is rejected.
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

// Recovers s28's renamed-no-preview base, missing from any standalone backup; the reversed base must splice cleanly or we fall through.
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
    // Reverse only when an at-or-before backup exists but differs from the reversed base — s28's rename-between-backups signature.
    const reversedContent = reversed.join("\n") + "\n";
    const atOrBefore = backupSeedWriteFor(records, event.target, event.timestamp, reader);
    if (atOrBefore === undefined || atOrBefore.content === reversedContent) {
        return undefined;
    }
    return { ...after, content: reversedContent };
}

// The synthetic Write spliced before `event` when its base is stale or out-of-window; undefined when the base is already intact.
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

// Record that a stale-edit-base reseed fired, tagging the edit it seeds and the backup time used.
function noteStaleSeed(event: FileEvent, seed: WriteEvent): void {
    noteStage({
        stage: "seedStaleEditBases",
        target: seed.target,
        changeId: event.kind === EventKind.edit ? event.changeId : seed.changeId,
        detail: "reseeded a stale mid-stream edit base from the file-history backup",
        when: seed.timestamp,
    });
}

// Generalises spec 39's edit-base seeding to mid-stream edits: splice backup-seed Write before each stale-base edit (s19), leaving intact ones unchanged.
export function seedStaleEditBases(
    records: TranscriptRecord[],
    lineage: FileEvent[],
    reader: BackupReader,
): FileEvent[] {
    const result: FileEvent[] = [];
    for (const event of lineage) {
        const rawSeed = staleEditSeedFor(records, event, result, reader);
        if (rawSeed) {
            // task 224: the seed sorts between the event it follows and edit it seeds; the stamp can sit outside both.
            const seed = clampSeedBetweenPreviousAndEdit(rawSeed, event.timestamp, result[result.length - 1]?.timestamp);
            noteStaleSeed(event, seed);
            result.push(seed);
        }
        result.push(event);
    }
    return result;
}


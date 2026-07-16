// Replay helpers: the per-line primitives (split/genesis/carry/presence) and the Edit
// splice. Imports nothing from reconstruction_replay.ts so the dependency runs one way
// (replay -> here), keeping the module graph acyclic. Design:
// plans/reconstruction-engine-design.md.

import type { StructuredPatchHunk } from "./structures/tool-results.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "./structures/line-model.ts";
import type {
    AppendEvent,
    EditEvent,
    FileRevision,
    LineEntry,
} from "./reconstruction_engine.ts";

// Split file content into lines; a single trailing newline is not a phantom line.
export function splitLines(content: string): string[] {
    const parts = content.split("\n");
    if (parts.length > 0 && parts[parts.length - 1] === "") {
        parts.pop();
    }
    return parts;
}

// A genesis line: born at this revision (no predecessor), one authored value.
export function genesisLine(line: string, timestamp: Date): LineEntry {
    return { oldLineNum: DOES_NOT_EXIST_YET, values: [{ line, timestamp }] };
}

// The file is present when the latest revision exists and is not a deletion — so a
// write after a delete is a fresh create, not an overwrite (locked decision 3).
export function fileIsPresent(revisions: FileRevision[]): boolean {
    const last = revisions[revisions.length - 1];
    return last !== undefined && last.kind !== EventKind.delete;
}

// The lines of the latest revision, or [] when there is none yet.
export function lastLinesOf(revisions: FileRevision[]): LineEntry[] {
    const last = revisions[revisions.length - 1];
    return last ? last.lines : [];
}

// Carry a working line forward unchanged, recording its current index as oldLineNum.
export function carryAt(entry: LineEntry, index: number): LineEntry {
    return { oldLineNum: index, values: entry.values };
}

function editRevision(event: EditEvent, lines: LineEntry[]): FileRevision {
    return {
        kind: EventKind.edit,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines,
    };
}

// The old-line indices (into the previous revision) that this hunk deletes. Walk
// the hunk: ' ' and '-' each consume one old line starting at oldStart-1; '-' is
// deleted.
function removedOldIndicesOf(hunk: StructuredPatchHunk): Set<number> {
    const removed = new Set<number>();
    let oldIndex = hunk.oldStart - 1;
    for (const line of hunk.lines) {
        if (line.startsWith("-")) {
            removed.add(oldIndex);
            oldIndex += 1;
        } else if (line.startsWith("+")) {
            // an inserted line consumes no old line
        } else {
            oldIndex += 1;
        }
    }
    return removed;
}

// Previous lines minus the removed indices; each survivor keeps its previous
// index as its oldLineNum back-pointer.
function keepSurvivingLines(
    previousLines: LineEntry[],
    removed: Set<number>,
): LineEntry[] {
    const survivors: LineEntry[] = [];
    for (let index = 0; index < previousLines.length; index++) {
        if (removed.has(index)) {
            continue;
        }
        survivors.push({ oldLineNum: index, values: previousLines[index]!.values });
    }
    return survivors;
}

// One context (' ') line of a hunk: carry the working line forward when it exists, or — when the base
// is empty because the creating Write is off-branch (conversation-only-rewind-then-edit, spec 39) —
// materialise it as a genesis line so the splice never indexes past the empty base. `born` reports
// whether the line was created here (so the caller marks the revision as having added a line).
function resolveContextLine(
    workingLines: LineEntry[],
    workingIndex: number,
    text: string,
    timestamp: Date,
): { entry: LineEntry; born: boolean } {
    const carried = workingLines[workingIndex];
    if (carried === undefined) {
        return { entry: genesisLine(text, timestamp), born: true };
    }
    return { entry: carryAt(carried, workingIndex), born: false };
}

// Insert the hunk's '+' lines among the (post-removal) working lines. Context
// lines carry their working index as oldLineNum and keep their existing values;
// '+' lines are born (-1) with the hunk text (its prefix char stripped) at the
// edit timestamp.
function insertHunkAdditions(
    workingLines: LineEntry[],
    hunk: StructuredPatchHunk,
    timestamp: Date,
): { lines: LineEntry[]; added: boolean } {
    const result: LineEntry[] = workingLines.slice(0, hunk.oldStart - 1).map(carryAt);
    let workingIndex = hunk.oldStart - 1;
    let added = false;
    for (const line of hunk.lines) {
        if (line.startsWith("-")) {
            continue;
        }
        if (line.startsWith("+")) {
            result.push(genesisLine(line.slice(1), timestamp));
            added = true;
            continue;
        }
        const context = resolveContextLine(workingLines, workingIndex, line.slice(1), timestamp);
        result.push(context.entry);
        added = added || context.born;
        workingIndex += 1;
    }
    for (let index = workingIndex; index < workingLines.length; index++) {
        result.push({ oldLineNum: index, values: workingLines[index]!.values });
    }
    return { lines: result, added };
}

// A `>>` append: carry the present file's lines forward unchanged (identity
// back-pointers) and add the redirect's new tail lines as genesis. When the file is
// absent the append creates it — every line genesis, kind write — mirroring how a
// write-to-absent is a create not an overwrite (locked decision 2).
export function appendRevision(
    event: AppendEvent,
    revisions: FileRevision[],
    present: boolean,
): FileRevision {
    const newLines = splitLines(event.content);
    if (!present) {
        return {
            kind: EventKind.write,
            changeId: event.changeId,
            timestamp: event.timestamp,
            lines: newLines.map((line) => genesisLine(line, event.timestamp)),
        };
    }
    const carried = lastLinesOf(revisions).map(carryAt);
    const appendedNewLines = newLines.slice(carried.length);
    const appended = appendedNewLines.map((line) => genesisLine(line, event.timestamp));
    return {
        kind: EventKind.append,
        changeId: event.changeId,
        timestamp: event.timestamp,
        lines: [...carried, ...appended],
    };
}

// Splice one Edit's hunks against the latest revision. A hunk with any '-' emits
// a removal revision; a hunk with any '+' emits an addition revision; both carry
// the Edit's changeId. Context lines keep identity; inserted lines are born (-1).
export function applyEdit(event: EditEvent, revisions: FileRevision[]): void {
    for (const hunk of event.hunks) {
        const previousLines = lastLinesOf(revisions);
        const removed = removedOldIndicesOf(hunk);
        if (removed.size > 0) {
            const removalLines = keepSurvivingLines(previousLines, removed);
            revisions.push(editRevision(event, removalLines));
        }
        const additionLines = insertHunkAdditions(lastLinesOf(revisions), hunk, event.timestamp);
        if (additionLines.added) {
            revisions.push(editRevision(event, additionLines.lines));
        }
    }
}

// Un-apply one hunk against POST-edit content: at newStart-1 the hunk's new-side region (' ' and '+'
// lines) sits in `afterLines`; replace it with the old-side region (' ' and '-' lines) to recover the
// pre-hunk lines. Returns undefined when the after content does not carry the hunk's ' '/'+' lines where
// newStart says — the after-backup is the wrong blob, so never fabricate.
function unapplyHunkAgainstAfter(afterLines: string[], hunk: StructuredPatchHunk): string[] | undefined {
    const head = afterLines.slice(0, hunk.newStart - 1);
    const preEditRegion: string[] = [];
    let afterIndex = hunk.newStart - 1;
    for (const line of hunk.lines) {
        const text = line.slice(1);
        if (line.startsWith("-")) {
            preEditRegion.push(text); // removed by the edit, so present pre-edit; absent from after
            continue;
        }
        // ' ' and '+' both occupy an after line; it must match here, else the after-backup is the wrong blob.
        if (afterLines[afterIndex] !== text) {
            return undefined;
        }
        afterIndex += 1;
        if (!line.startsWith("+")) {
            preEditRegion.push(text); // a context line survives into the pre-edit region too
        }
    }
    return [...head, ...preEditRegion, ...afterLines.slice(afterIndex)];
}

// The pre-edit lines recovered by un-applying ALL of `event`'s hunks against post-edit `afterLines`,
// latest hunk first so earlier hunks' indices stay valid. undefined when any hunk fails to match (the
// after content is the wrong blob — recover nothing rather than fabricate).
export function reverseEditFromAfter(afterLines: string[], event: EditEvent): string[] | undefined {
    let lines = afterLines;
    for (let index = event.hunks.length - 1; index >= 0; index -= 1) {
        const reversed = unapplyHunkAgainstAfter(lines, event.hunks[index]!);
        if (reversed === undefined) {
            return undefined;
        }
        lines = reversed;
    }
    return lines;
}


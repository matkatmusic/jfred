// Presentation for the reconstruction engine: render a file's revisions as a
// full line-state view (--verbose) or as a diff between revisions (--diff).
// Pure functions over FileRevision[]; no IO. Design: reconstruction_engine.ts.

import type { FileRevision, LineEntry } from "./reconstruction_engine.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "./structures/line-model.ts";
import type { Path } from "./structures/domain.ts";

// A line's believed content right now is the last value in its history.
export function currentText(entry: LineEntry): string {
    return entry.values[entry.values.length - 1]!.line;
}

function renderNumberedLine(entry: LineEntry, index: number): string {
    return `  ${String(index + 1).padStart(4)} | ${currentText(entry)}`;
}

// Describe a path transition as `from → to` (the two paths a rename or copy
// connects, joined by an arrow).
function renderPathArrow(transition: { from: Path; to: Path }): string {
    return `${transition.from} → ${transition.to}`;
}

function renderRevisionState(revision: FileRevision, index: number): string {
    const stamp = revision.timestamp.toISOString();
    if (revision.kind === EventKind.rename && revision.rename) {
        return `revision ${index}  rename  ${renderPathArrow(revision.rename)}  @ ${stamp}`;
    }
    if (revision.kind === EventKind.copy && revision.copy) {
        const count = revision.lines.length;
        const header = `revision ${index}  copy  ${renderPathArrow(revision.copy)}  @ ${stamp}  (${count} lines)`;
        const body = revision.lines.map(renderNumberedLine).join("\n");
        return `${header}\n${body}`;
    }
    const count = revision.lines.length;
    const header = `revision ${index}  @ ${stamp}  (${count} lines)`;
    if (count === 0) {
        return `${header}\n  (file absent — 0 lines)`;
    }
    const body = revision.lines.map(renderNumberedLine).join("\n");
    return `${header}\n${body}`;
}

// Render each revision's full line state (the --verbose view).
export function renderVerbose(revisions: FileRevision[]): string {
    return revisions.map(renderRevisionState).join("\n\n");
}

function diffLabel(before: string[], after: string[]): string {
    if (before.length === 0) {
        return "created";
    }
    if (after.length === 0) {
        return "deleted";
    }
    return "changed";
}

// The previous-revision indices a current revision still keeps (via back-pointer).
function keptOldIndices(revision: FileRevision): Set<number> {
    const indices = new Set<number>();
    for (const entry of revision.lines) {
        if (entry.oldLineNum >= 0) {
            indices.add(entry.oldLineNum);
        }
    }
    return indices;
}

// Previous lines whose index no current entry points back to (a real removal).
function removedLines(
    previous: FileRevision | undefined,
    revision: FileRevision,
): string[] {
    if (!previous) {
        return [];
    }
    const kept = keptOldIndices(revision);
    const removed: string[] = [];
    previous.lines.forEach((entry, index) => {
        if (!kept.has(index)) {
            removed.push(`- ${currentText(entry)}`);
        }
    });
    return removed;
}

// Current entries born here (oldLineNum DOES_NOT_EXIST_YET) are the real additions.
function addedLines(revision: FileRevision): string[] {
    const bornEntries = revision.lines.filter((entry) => entry.oldLineNum === DOES_NOT_EXIST_YET);
    const added = bornEntries.map((entry) => `+ ${currentText(entry)}`);
    return added;
}

// The kind-specific "@@ … @@" block header line, shared by both diff renderers.
export function computeDiffBlockHeader(
    previous: FileRevision | undefined,
    revision: FileRevision,
): string {
    const stamp = revision.timestamp.toISOString();
    if (revision.kind === EventKind.rename && revision.rename) {
        return `@@ renamed ${renderPathArrow(revision.rename)} @ ${stamp} @@`;
    }
    if (revision.kind === EventKind.copy && revision.copy) {
        return `@@ copied ${renderPathArrow(revision.copy)} @ ${stamp} @@`;
    }
    if (revision.kind === EventKind.overwrite) {
        return `@@ overwritten @ ${stamp} @@`;
    }
    if (revision.kind === EventKind.append) {
        return `@@ appended @ ${stamp} @@`;
    }
    const before = previous ? previous.lines.map(currentText) : [];
    const after = revision.lines.map(currentText);
    return `@@ ${diffLabel(before, after)} @ ${stamp} @@`;
}

// Render one revision as a diff against the previous one. Real changes only: a
// removal is a previous line no current entry points back to; an addition is a
// line born here (oldLineNum DOES_NOT_EXIST_YET). A rename is its own block with no line churn.
function diffBlock(
    previous: FileRevision | undefined,
    revision: FileRevision,
): string {
    const header = computeDiffBlockHeader(previous, revision);
    if (revision.kind === EventKind.rename && revision.rename) {
        return header;
    }
    if (revision.kind === EventKind.copy && revision.copy) {
        return [header, ...addedLines(revision)].join("\n");
    }
    if (revision.kind === EventKind.append) {
        return [header, ...addedLines(revision)].join("\n");
    }
    return [header, ...removedLines(previous, revision), ...addedLines(revision)].join("\n");
}

// Render the changes between consecutive revisions as a diff (the --diff view).
export function renderDiff(revisions: FileRevision[]): string {
    const blocks: string[] = [];
    let previous: FileRevision | undefined;
    for (const revision of revisions) {
        blocks.push(diffBlock(previous, revision));
        previous = revision;
    }
    return blocks.join("\n");
}

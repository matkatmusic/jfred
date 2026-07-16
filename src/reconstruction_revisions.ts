// Revision selection and text helpers, split out of reconstruction_branches.ts to keep both files
// within the 250-line cap — split, never condense.

import type { FileRevision } from "./reconstruction_engine.ts";

// The latest revision whose timestamp is at or before `when`, or undefined.
export function lastRevisionAtOrBefore(
    revisions: FileRevision[],
    when: Date,
): FileRevision | undefined {
    let chosen: FileRevision | undefined;
    for (const revision of revisions) {
        if (revision.timestamp.getTime() <= when.getTime()) {
            chosen = revision;
        }
    }
    return chosen;
}

// The latest revision whose timestamp is strictly before `when`, or undefined. Strictly-before is
// required so a script run never seeds itself from its own injected output.
export function lastRevisionStrictlyBefore(
    revisions: FileRevision[],
    when: Date,
): FileRevision | undefined {
    let chosen: FileRevision | undefined;
    for (const revision of revisions) {
        if (revision.timestamp.getTime() < when.getTime()) {
            chosen = revision;
        }
    }
    return chosen;
}

// The believed text of each line in a revision (its latest value).
export function linesTextOf(revision: FileRevision): string[] {
    return revision.lines.map(
        (entry) => entry.values[entry.values.length - 1]!.line,
    );
}

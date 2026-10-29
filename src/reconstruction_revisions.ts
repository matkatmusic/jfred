// Revision selection and text helpers, split out of reconstruction_branches.ts to keep both files under 250 lines.

import type { FileRevision } from "./reconstruction_events.ts";

// The latest revision whose timestamp is at or before `when`, or undefined.
export function findLastRevisionAtOrBefore(
  revisions: FileRevision[],
  when: Date,
): FileRevision | undefined {
  let chosen: FileRevision | undefined;
  const whenMs = when.getTime();
  for (const revision of revisions) {
    const revisionMs = revision.timestamp.getTime();
    if (revisionMs <= whenMs) {
      chosen = revision;
    }
  }
  return chosen;
}

// The latest revision strictly before `when`, or undefined, so a script run never seeds itself.
export function findLastRevisionStrictlyBefore(
  revisions: FileRevision[],
  when: Date,
): FileRevision | undefined {
  let chosen: FileRevision | undefined;
  const whenMs = when.getTime();
  for (const revision of revisions) {
    const revisionMs = revision.timestamp.getTime();
    if (revisionMs < whenMs) {
      chosen = revision;
    }
  }
  return chosen;
}

// The believed text of each line in a revision (its latest value).
export function getLinesText(revision: FileRevision): string[] {
  const lineTexts: string[] = [];
  for (const entry of revision.lines) {
    lineTexts.push(entry.values[entry.values.length - 1]!.line);
  }
  return lineTexts;
}

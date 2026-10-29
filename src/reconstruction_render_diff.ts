// Renders a file's revisions as a diff between consecutive revisions (--diff). Pure functions; no IO.

import type { FileRevision, LineEntry } from "./reconstruction_events.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { DOES_NOT_EXIST_YET } from "./structures/line-model.ts";
import { getCurrentText, renderPathArrow } from "./reconstruction_render.ts";

function collectCurrentTexts(lines: LineEntry[]): string[] {
  const texts: string[] = [];
  for (const entry of lines) {
    texts.push(getCurrentText(entry));
  }
  return texts;
}

function computeDiffLabel(before: string[], after: string[]): string {
  if (before.length === 0) {
    return "created";
  }
  if (after.length === 0) {
    return "deleted";
  }
  return "changed";
}

// The previous-revision indices a current revision still keeps (via back-pointer).
function collectKeptOldIndices(revision: FileRevision): Set<number> {
  const indices = new Set<number>();
  for (const entry of revision.lines) {
    if (entry.oldLineNum >= 0) {
      indices.add(entry.oldLineNum);
    }
  }
  return indices;
}

// Previous lines whose index no current entry points back to (a real removal).
function collectRemovedLines(
  previous: FileRevision | undefined,
  revision: FileRevision,
): string[] {
  if (!previous) {
    return [];
  }
  const kept = collectKeptOldIndices(revision);
  const removed: string[] = [];
  for (let index = 0; index < previous.lines.length; index++) {
    const isRemoved = !kept.has(index);
    if (isRemoved) {
      removed.push(`- ${getCurrentText(previous.lines[index]!)}`);
    }
  }
  return removed;
}

// Current entries born here (oldLineNum DOES_NOT_EXIST_YET) are the real additions.
function collectAddedLines(revision: FileRevision): string[] {
  const added: string[] = [];
  for (const entry of revision.lines) {
    const isBorn = entry.oldLineNum === DOES_NOT_EXIST_YET;
    if (isBorn) {
      added.push(`+ ${getCurrentText(entry)}`);
    }
  }
  return added;
}

// The kind-specific "@@ … @@" block header line, shared by both diff renderers.
export function computeDiffBlockHeader(
  previous: FileRevision | undefined,
  revision: FileRevision,
): string {
  const stamp = revision.timestamp.toISOString();
  const rename = revision.rename;
  const copy = revision.copy;
  const isRename = revision.kind === EventKind.rename && rename !== undefined;
  if (isRename) {
    return `@@ renamed ${renderPathArrow(rename)} @ ${stamp} @@`;
  }
  const isCopy = revision.kind === EventKind.copy && copy !== undefined;
  if (isCopy) {
    return `@@ copied ${renderPathArrow(copy)} @ ${stamp} @@`;
  }
  if (revision.kind === EventKind.overwrite) {
    return `@@ overwritten @ ${stamp} @@`;
  }
  if (revision.kind === EventKind.append) {
    return `@@ appended @ ${stamp} @@`;
  }
  const before = previous ? collectCurrentTexts(previous.lines) : [];
  const after = collectCurrentTexts(revision.lines);
  return `@@ ${computeDiffLabel(before, after)} @ ${stamp} @@`;
}

// Render one revision as a diff against the previous one; a rename is a header-only block.
function renderDiffBlock(
  previous: FileRevision | undefined,
  revision: FileRevision,
): string {
  const header = computeDiffBlockHeader(previous, revision);
  const isRename = revision.kind === EventKind.rename && revision.rename !== undefined;
  if (isRename) {
    return header;
  }
  const isCopy = revision.kind === EventKind.copy && revision.copy !== undefined;
  if (isCopy) {
    return [header, ...collectAddedLines(revision)].join("\n");
  }
  if (revision.kind === EventKind.append) {
    return [header, ...collectAddedLines(revision)].join("\n");
  }
  return [header, ...collectRemovedLines(previous, revision), ...collectAddedLines(revision)].join("\n");
}

// Render the changes between consecutive revisions as a diff (the --diff view).
export function renderDiff(revisions: FileRevision[]): string {
  const blocks: string[] = [];
  let previous: FileRevision | undefined;
  for (const revision of revisions) {
    blocks.push(renderDiffBlock(previous, revision));
    previous = revision;
  }
  return blocks.join("\n");
}

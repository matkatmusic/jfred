// One numbered list-view entry: kind label, line count or rename/copy detail, short time, short change id.

import type { FileRevision } from "./reconstruction_events.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { getBaseName, shortenChangeId } from "./reconstruction_labels.ts";

// The clock portion of a timestamp (HH:MM:SSZ).
function formatShortTime(date: Date): string {
  return `${date.toISOString().slice(11, 19)}Z`;
}

// A short label for the kind that produced an entry.
function getEntryLabel(kind: EventKind): string {
  if (kind === EventKind.write) {
    return "create";
  }
  if (kind === EventKind.edit) {
    return "edit";
  }
  if (kind === EventKind.rename) {
    return "rename";
  }
  if (kind === EventKind.copy) {
    return "copy";
  }
  if (kind === EventKind.overwrite) {
    return "overwrite";
  }
  if (kind === EventKind.append) {
    return "append";
  }
  if (kind === EventKind.userEdit) {
    return "user-edit";
  }
  return "delete";
}

// The line-count change versus the previous entry, e.g. `  (+4)` / `  (−1)`.
function getEntryDelta(
  previous: FileRevision | undefined,
  revision: FileRevision,
): string {
  if (!previous) {
    return "";
  }
  const diff = revision.lines.length - previous.lines.length;
  if (diff === 0) {
    return "";
  }
  return diff > 0 ? `  (+${diff})` : `  (−${-diff})`;
}

// The middle column: a rename shows its from -> to; others show their line count.
function getEntryDetail(
  previous: FileRevision | undefined,
  revision: FileRevision,
): string {
  const rename = revision.kind === EventKind.rename ? revision.rename : undefined;
  if (rename) {
    return `${getBaseName(rename.from)} → ${getBaseName(rename.to)}`;
  }
  const copy = revision.kind === EventKind.copy ? revision.copy : undefined;
  if (copy) {
    return `${revision.lines.length} lines  (copied from ${getBaseName(copy.from)})`;
  }
  return `${revision.lines.length} lines${getEntryDelta(previous, revision)}`;
}

export function renderEntry(
  revision: FileRevision,
  index: number,
  previous: FileRevision | undefined,
): string {
  const label = getEntryLabel(revision.kind).padEnd(6);
  const detail = getEntryDetail(previous, revision);
  return `  ${index}  ${label}  ${detail}   ${formatShortTime(revision.timestamp)}  #${shortenChangeId(revision.changeId)}`;
}

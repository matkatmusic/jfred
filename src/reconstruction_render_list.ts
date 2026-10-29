// Default list view: one block per touched file with its numbered entries. Pure over FileHistory[].

import type { FileHistory, FileRevision } from "./reconstruction_events.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { getBaseName } from "./reconstruction_labels.ts";
import type { Path } from "./structures/domain.ts";
import { renderEntry } from "./reconstruction_render_entry.ts";

// The pre-rename path a history started life at, if it was ever renamed.
function findOriginalPath(revisions: FileRevision[]): Path | undefined {
  for (const revision of revisions) {
    const rename = revision.kind === EventKind.rename ? revision.rename : undefined;
    if (rename) {
      return rename.from;
    }
  }
  return undefined;
}

// The source path a copied history was born from, if it began as a copy.
function findCopyOrigin(revisions: FileRevision[]): Path | undefined {
  for (const revision of revisions) {
    const copy = revision.kind === EventKind.copy ? revision.copy : undefined;
    if (copy) {
      return copy.from;
    }
  }
  return undefined;
}

function renderHistoryBlock(history: FileHistory): string {
  const was = findOriginalPath(history.revisions);
  const copiedFrom = findCopyOrigin(history.revisions);
  let header = `${history.target}`;
  if (was) {
    header = `${history.target}   (was ${getBaseName(was)})`;
  }
  else if (copiedFrom) {
    header = `${history.target}   (copy of ${getBaseName(copiedFrom)})`;
  }
  const entries: string[] = [];
  let previous: FileRevision | undefined;
  for (const [index, revision] of history.revisions.entries()) {
    entries.push(renderEntry(revision, index, previous));
    previous = revision;
  }
  return `${header}\n${entries.join("\n")}`;
}

// The default view: each touched file with its numbered entries.
export function renderHistoryList(histories: FileHistory[]): string {
  if (histories.length === 0) {
    return "no files touched";
  }
  const blocks: string[] = [];
  for (const history of histories) {
    blocks.push(renderHistoryBlock(history));
  }
  return blocks.join("\n\n");
}

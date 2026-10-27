// Files-pane flat entries, split from timeline-file-tree.ts (items 66/77, task 91).

import { applyRenameBadgeLabels, findScriptRenameSource } from "./timeline-file-badges.ts";
import { DELETE_EVENT_KIND, RENAME_EVENT_KIND } from "./timeline-types.ts";
import type { WireFileHistory, WireTimelineDocument } from "./timeline-wire-types.ts";

// One Files-pane entry: the file plus the two facts the tree renders differently (item 77).
export type FileSidebarEntry = {
  target: string;
  revisionCount: number;
  // True only when the LAST revision is a delete: m4's write->delete->write recreate ends alive.
  isDeleted: boolean;
  // The path the file was born at; recoverable only from the rename revision. undefined when never renamed.
  originalPath: string | undefined;
  // Shortest suffix of originalPath that no other rename badge shares (task 91). Stamped by applyRenameBadgeLabels.
  renameBadgeLabel: string | undefined;
};

// Every surviving touched file with its revision count, delete/rename facts, and disambiguated rename badge.
export function buildFilesSidebarViewModel(document: WireTimelineDocument): FileSidebarEntry[] {
  const entries: FileSidebarEntry[] = [];
  for (const history of document.filesTouched) {
    entries.push(buildSidebarEntry(document, history));
  }
  applyRenameBadgeLabels(entries);
  return entries;
}

function buildSidebarEntry(document: WireTimelineDocument, history: WireFileHistory): FileSidebarEntry {
  return {
    target: history.target,
    revisionCount: history.revisions.length,
    isDeleted: findLastRevisionKind(history) === DELETE_EVENT_KIND,
    originalPath: findOriginalPath(history) ?? findScriptRenameSource(document, history.target),
    renameBadgeLabel: undefined,
  };
}

// The kind of the revision a file ends life at; undefined for an empty history.
function findLastRevisionKind(history: WireFileHistory): string | undefined {
  return history.revisions[history.revisions.length - 1]?.kind;
}

// The FIRST rename revision's `from`: in a chain a->b->c the earliest `from` is the origin.
function findOriginalPath(history: WireFileHistory): string | undefined {
  for (const revision of history.revisions) {
    if (revision.kind === RENAME_EVENT_KIND) {
      return revision.rename?.from;
    }
  }
  return undefined;
}

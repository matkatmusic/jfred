// One change's revision diff in the Details right pane.

import { findRevisionForChangeId } from "./file-history-model.ts";
import { computeRevisionDiffFallbackText } from "./timeline-labels-tags.ts";
import { type FileChange } from "./timeline-types.ts";
import { type WireFileHistory } from "./details-model.ts";
import { renderDiffInDetails, renderTextInDetails } from "./details-diff.ts";

// One change's revision diff: changeId resolves to a revision block; no-hunk cases render their fallback text.
export async function renderRevisionDiffInDetails(change: FileChange, blocks: string[], filesTouched: WireFileHistory[], reload: () => void): Promise<void> {
  const link = change.changeId === undefined ? undefined : findRevisionForChangeId(filesTouched, change.changeId, undefined);
  const block = link?.revisionNumber === undefined ? undefined : blocks[link.revisionNumber - 1];
  const fallbackText = computeRevisionDiffFallbackText(block, change);
  // displayPath, not path (task 127): the pane label shows the entry-time file name.
  if (fallbackText !== undefined) {
    renderTextInDetails(change.displayPath, fallbackText);
    return;
  }
  renderDiffInDetails(change.displayPath, change.displayPath, block!, reload);
}

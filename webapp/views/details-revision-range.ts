// Range-diff selection for the Revision View: card toggles and the picked run's diff.

import { splitPatchByFile } from "./timeline-patch-split.ts";
import { computeRangeSummary } from "./timeline-picks.ts";
import { isCardRunContiguous, computeOwningNodeIndexes } from "./details-model.ts";
import { showDiffInDetails, showTextInDetails } from "./details-diff.ts";
import { type RevisionPage, renderFocusedCard } from "./details-revision-diff.ts";

function compareAscending(left: number, right: number): number {
  return left - right;
}

// Every glyph re-reads the set so the whole run agrees after one click.
export function refreshRangeToggleGlyphs(page: RevisionPage): void {
  for (let toggleIndex = 0; toggleIndex < page.rangeToggles.length; toggleIndex++) {
    page.rangeToggles[toggleIndex]!.textContent = page.rangeSelected.has(toggleIndex) ? "☑" : "☐";
  }
}

function findTargetBlock(patchText: string, target: string): ReturnType<typeof splitPatchByFile>[number] | undefined {
  const patchBlocks = splitPatchByFile(patchText);
  for (const entry of patchBlocks) {
    const isTarget = target === entry.path || target.endsWith(`/${entry.path}`);
    if (isTarget)
      return entry;
  }
  return undefined;
}

// Card run to owning nodes to step range to the server's range patch to this file's block.
export async function renderRangeDiff(page: RevisionPage): Promise<void> {
  const { target, context, cards } = page;
  function refreshRangeDiff(): void {
    void renderRangeDiff(page);
  }
  const selectedIndexes = [...page.rangeSelected].sort(compareAscending);
  const isContiguousRun = isCardRunContiguous(selectedIndexes);
  if (!isContiguousRun) {
    showTextInDetails(target, "(pick a contiguous run of revisions)");
    return;
  }
  const ownerIndexes = computeOwningNodeIndexes(cards, context.nodes, selectedIndexes);
  if (ownerIndexes.length === 0) {
    showTextInDetails(target, "(no timeline steps own the picked revisions)");
    return;
  }
  const summary = computeRangeSummary(context.nodes, ownerIndexes);
  const patchText = await context.fetchRangePatch(summary.fromStepIndex, summary.toStepIndex);
  const block = findTargetBlock(patchText, target);
  const firstNumber = selectedIndexes[0]! + 1;
  const lastNumber = selectedIndexes[selectedIndexes.length - 1]! + 1;
  const label = `${target} — revisions #${firstNumber}→#${lastNumber}`;
  if (block === undefined) {
    showTextInDetails(label, "(file unchanged across the picked revisions)");
    return;
  }
  showDiffInDetails(label, target, block.block, refreshRangeDiff);
}

// Flip glyphs in place: re-entering renderDetailsFileMode would drop the selection and focus.
export function toggleRangeCard(page: RevisionPage, index: number): void {
  const wasSelected = page.rangeSelected.has(index);
  if (wasSelected) {
    page.rangeSelected.delete(index);
  }
  else {
    page.rangeSelected.add(index);
  }
  refreshRangeToggleGlyphs(page);
  if (page.rangeSelected.size === 0) {
    renderFocusedCard(page);
    return;
  }
  void renderRangeDiff(page);
}

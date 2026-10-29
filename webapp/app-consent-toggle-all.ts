// Consent dialog Expand All / Collapse All button: expands every long preview and read-only block together.

import { isConsentScriptOverflowingPreview } from "./app-consent-model.ts";
import { isAnyBlockClosed, listReadOnlyBlocks, updateRowExpandButtonLabel } from "./app-consent-rows.ts";

// Re-queried per click since Expand and Show/hide share state.
function collectExpandables(box: HTMLElement): { previews: HTMLPreElement[]; readOnlyBlocks: HTMLDetailsElement[] } {
  const previews: HTMLPreElement[] = [];
  for (const pre of box.querySelectorAll<HTMLPreElement>(".consent-script pre")) {
    const overflowsPreview = isConsentScriptOverflowingPreview(pre.textContent ?? "");
    if (overflowsPreview) {
      previews.push(pre);
    }
  }
  return { previews, readOnlyBlocks: listReadOnlyBlocks(box) };
}

function isAnyPreviewCollapsed(previews: HTMLPreElement[]): boolean {
  for (const pre of previews) {
    const isExpanded = pre.classList.contains("expanded");
    if (!isExpanded) {
      return true;
    }
  }
  return false;
}

// onclick, not addEventListener, so re-renders never stack handlers.
export function attachToggleAllButton(box: HTMLElement, toggleAllButton: HTMLButtonElement): void {
  function updateToggleAllLabel(): void {
    const { previews, readOnlyBlocks } = collectExpandables(box);
    const anyCollapsed = isAnyPreviewCollapsed(previews) || isAnyBlockClosed(readOnlyBlocks);
    const nothingExpandable = previews.length === 0 && readOnlyBlocks.length === 0;
    toggleAllButton.textContent = anyCollapsed || nothingExpandable ? "Expand All" : "Collapse All";
  }
  toggleAllButton.onclick = () => {
    const { previews, readOnlyBlocks } = collectExpandables(box);
    const shouldExpand = isAnyPreviewCollapsed(previews) || isAnyBlockClosed(readOnlyBlocks);
    for (const pre of previews)
      pre.classList.toggle("expanded", shouldExpand);
    for (const block of readOnlyBlocks)
      block.open = shouldExpand;
    for (const pre of previews) {
      updateRowExpandButtonLabel(pre, shouldExpand);
    }
    updateToggleAllLabel();
  };
  updateToggleAllLabel();
}

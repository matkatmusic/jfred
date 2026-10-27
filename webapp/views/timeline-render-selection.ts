// Timeline row selection, the Expand All toggle, and Prev/Next header navigation (task 92).

import { renderDetailsCommitMode, renderDetailsMessageMode } from "./details.ts";
import { renderDetailsScriptRunMode } from "./details-script-run.ts";
import { clearFileSelectionIn } from "./sidebar.ts";
import { findContributingNodeIndexes } from "./timeline-commit-files.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { findAdjacentFileTouchedIndex, findAdjacentRowIndex } from "./timeline-sessions.ts";
import { COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND } from "./timeline-types.ts";

// Restart the row-flash animation (mockup jumpToTimelineRow's remove/reflow/add dance).
export function resetRowFlash(row: HTMLElement): void {
  row.classList.remove("flash");
  void row.offsetWidth;                              // restart the CSS animation
  row.classList.add("flash");
  const removeFlash = (): void => {
    row.classList.remove("flash");
  };
  setTimeout(removeFlash, 1300);
}

// Sidebar session clicks and the session-anchor route land here: scroll + flash the row.
export function moveToTimelineRow(context: TimelineRenderContext, nodeIndex: number): void {
  const row = context.nodeRows.get(nodeIndex);
  if (row === undefined) {
    return;
  }
  row.scrollIntoView({ block: "start" });
  resetRowFlash(row);
}

// Select a row, render its details, then center it after the panes reflow (item 50).
export async function selectTimelineRow(context: TimelineRenderContext, nodeIndex: number): Promise<void> {
  const row = context.nodeRows.get(nodeIndex);
  if (row === undefined) {
    return;
  }
  if (context.selectedRow !== null) {
    context.selectedRow.classList.remove("selected");
  }
  context.selectedRow = row;
  context.fileNavReferenceIndex = nodeIndex;         // Prev/Next walk from the manual selection
  context.refreshFileNavButtons();
  row.classList.add("selected");
  for (const other of context.nodeRows.values()) {
    other.classList.remove("contrib");
  }
  // Leaving file mode clears only the Files sidebar tree (item 84).
  clearFileSelectionIn(document.getElementById("drawer")!);
  const node = context.nodes[nodeIndex]!;
  const isScriptRunToolCall = node.kind === TOOL_CALL_NODE_KIND && node.scriptRun !== undefined;
  if (node.kind === COMMIT_NODE_KIND) {
    for (const contributingIndex of findContributingNodeIndexes(context.nodes, nodeIndex)) {
      context.nodeRows.get(contributingIndex)?.classList.add("contrib");
    }
    await renderDetailsCommitMode(node, nodeIndex, context.detailsContext);
  }
  else if (isScriptRunToolCall) {
    // task 67: a script run that changed files gets script plus before/after mode.
    await renderDetailsScriptRunMode(node, nodeIndex, context.detailsContext);
  }
  else {
    await renderDetailsMessageMode(node, nodeIndex, context.detailsContext);
  }
  row.scrollIntoView({ block: "center" });
}

// ── Expand All / Collapse All: onclick assignment so re-renders never stack handlers. ──
function isAnyRowCollapsed(expandableRows: HTMLElement[]): boolean {
  for (const expandable of expandableRows) {
    const isExpanded = expandable.classList.contains("expanded");
    if (!isExpanded)
      return true;
  }
  return false;
}

export function attachToggleAllButton(context: TimelineRenderContext): void {
  const toggleAllButton = document.getElementById("toggle-all") as HTMLButtonElement;
  const updateToggleLabel = (): void => {
    const anyCollapsed = isAnyRowCollapsed(context.expandableRows);
    toggleAllButton.textContent = anyCollapsed ? "Expand All" : "Collapse All";
  };
  context.updateToggleLabel = updateToggleLabel;
  toggleAllButton.onclick = () => {
    const anyCollapsed = isAnyRowCollapsed(context.expandableRows);
    for (const expandable of context.expandableRows) {
      expandable.classList.toggle("expanded", anyCollapsed);
    }
    updateToggleLabel();
  };
  updateToggleLabel();
}

// ── Header Prev/Next over file-touching turns (task 85) and the line stepper (task 131). ──
export function attachFileNavButtons(context: TimelineRenderContext): void {
  const filesPrevButton = document.getElementById("files-prev") as HTMLButtonElement;
  const filesNextButton = document.getElementById("files-next") as HTMLButtonElement;
  const linePrevButton = document.getElementById("line-prev") as HTMLButtonElement;
  const lineNextButton = document.getElementById("line-next") as HTMLButtonElement;
  context.refreshFileNavButtons = () => {
    filesPrevButton.disabled = findAdjacentFileTouchedIndex(context.nodes, context.fileNavReferenceIndex, -1) === undefined;
    filesNextButton.disabled = findAdjacentFileTouchedIndex(context.nodes, context.fileNavReferenceIndex, 1) === undefined;
    linePrevButton.disabled = findAdjacentRowIndex(context.nodes, context.fileNavReferenceIndex, -1) === undefined;
    lineNextButton.disabled = findAdjacentRowIndex(context.nodes, context.fileNavReferenceIndex, 1) === undefined;
  };
  const moveToAdjacentFileTouchedRow = (direction: 1 | -1): void => {
    const target = findAdjacentFileTouchedIndex(context.nodes, context.fileNavReferenceIndex, direction);
    if (target === undefined) {
      return;
    }
    context.nodeRows.get(target)!.classList.add("expanded");   // expand BEFORE selecting so centering sees the bubble
    context.updateToggleLabel();
    void context.selectTimelineRow(target);                    // selects + renders details + centers; also updates fileNavReferenceIndex + button states
  };
    // task 131: one visible row per click, with no expand step.
  const selectAdjacentRow = (direction: 1 | -1): void => {
    const target = findAdjacentRowIndex(context.nodes, context.fileNavReferenceIndex, direction);
    if (target === undefined) {
      return;
    }
    void context.selectTimelineRow(target);
  };
  filesPrevButton.onclick = () => moveToAdjacentFileTouchedRow(-1);
  filesNextButton.onclick = () => moveToAdjacentFileTouchedRow(1);
  linePrevButton.onclick = () => selectAdjacentRow(-1);
  lineNextButton.onclick = () => selectAdjacentRow(1);
  context.refreshFileNavButtons();
}

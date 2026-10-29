// Item 43: open the transcript inspector and keep the timeline selection in step with its shown line.

import { openTranscriptInspector } from "../inspector.ts";
import { findTimelineNodeIndexForRawLine } from "./timeline-labels-raw-line.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";

// Item 43: sync timeline selection to the inspector's shown line on Prev/Next jumps.
export function syncSelectedRowToShownLine(context: TimelineRenderContext, rawLines: string[], shownLine: number): void {
  const nodeIndex = findTimelineNodeIndexForRawLine(context.nodes, rawLines[shownLine] ?? "");
  if (nodeIndex === -1) {
    return;
  }
  const row = context.nodeRows.get(nodeIndex);
  if (row === undefined) {
    return;
  }
  if (row === context.selectedRow) {
    return;
  }
  if (context.selectedRow !== null) {
    context.selectedRow.classList.remove("selected");
  }
  context.selectedRow = row;
  row.classList.add("selected");
  // Item 45: scroll only when the row is outside the pane; details pane already shows the inspector.
  row.scrollIntoView({ block: "nearest" });
}

// Wrapper that syncs timeline selection when the inspector's shown line changes (item 43).
export function openTranscriptInspectorSynced(context: TimelineRenderContext, options: { jsonlName: string; rawLines: string[]; line: number }): void {
  openTranscriptInspector({
    ...options,
    onJumpToLine: (shownLine) => syncSelectedRowToShownLine(context, options.rawLines, shownLine),
  });
  // Task 258: details pane reveal shrinks timeline; re-center the row post-reflow to avoid off-screen.
  context.selectedRow?.scrollIntoView({ block: "center" });
}

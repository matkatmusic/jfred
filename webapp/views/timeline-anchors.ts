// Deep-link anchors: scroll to a session's first row, or open an exact transcript line.

import { fetchRawRecords } from "../app-fetch.ts";
import { findTimelineNodeIndexForRawLine } from "./timeline-labels-raw-line.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { openTranscriptInspectorSynced } from "./timeline-render-inspectors.ts";
import type { TimelineNode } from "./timeline-types.ts";

export function findFirstNodeIndexForJsonl(nodes: TimelineNode[], anchorJsonl: string): number {
  for (let index = 0; index < nodes.length; index++) {
    const sessionId = nodes[index]?.sessionId;
    if (sessionId === undefined) {
      continue;
    }
    const isSessionMatch = anchorJsonl.startsWith(sessionId);
    if (isSessionMatch) {
      return index;
    }
  }
  return -1;
}

export function moveToSessionAnchor(context: TimelineRenderContext, anchorJsonl: string): void {
  const firstNodeIndex = findFirstNodeIndexForJsonl(context.nodes, anchorJsonl);
  if (firstNodeIndex >= 0) {
    context.jumpToTimelineRow(firstNodeIndex);
  }
}

// Select the row, open its exact line, then center-scroll last since opening reflows the panes.
export async function openLineAnchor(context: TimelineRenderContext, anchorJsonl: string, anchorLine: string): Promise<void> {
  const rawLines = await fetchRawRecords(context.project, anchorJsonl);
  const rawLineIndex = Number(anchorLine);
  const nodeIndex = findTimelineNodeIndexForRawLine(context.nodes, rawLines[rawLineIndex] ?? "");
  if (nodeIndex >= 0) {
    await context.selectTimelineRow(nodeIndex);
  }
  openTranscriptInspectorSynced(context, { jsonlName: anchorJsonl, rawLines, line: rawLineIndex });
  context.nodeRows.get(nodeIndex)?.scrollIntoView({ block: "center" });
}

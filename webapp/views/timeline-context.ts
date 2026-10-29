// Builds the one shared TimelineRenderContext every timeline-render-* module calls through.

import { createElement } from "../app-dom.ts";
import { openInspectorPane } from "../inspector-pane.ts";
import { clearActiveChip, markChipActive } from "./timeline-render-chips.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import { openTranscriptInspectorSynced } from "./timeline-inspector-sync.ts";
import { findTranscriptLineForChangeId } from "./timeline-line-locations.ts";
import { openNodeInspector } from "./timeline-render-inspectors.ts";
import { fetchRangePatch } from "./timeline-render-selectbar.ts";
import { updateSelectbar } from "./timeline-render-pickbar.ts";
import { moveToTimelineRow, resetRowFlash, selectTimelineRow } from "./timeline-render-selection.ts";
import { computeGraphLaneRuns, type WireProjectListing } from "./timeline-sessions.ts";
import type { TimelineNode, TranscriptLocation } from "./timeline-node-types.ts";
import type { WireTimelineDocument } from "./timeline-wire-types.ts";

export type TimelineContextInputs = {
  project: string;
  nodes: TimelineNode[];
  listing: WireProjectListing | undefined;
  reconstructionDocument: WireTimelineDocument;
  sessionColors: Map<string, string>;
  selectbar: HTMLElement;
  barText: HTMLElement;
  ruleHint: HTMLElement;
};

export async function selectTimelineRowAndFlash(context: TimelineRenderContext, nodeIndex: number): Promise<void> {
  await selectTimelineRow(context, nodeIndex);
  const row = context.nodeRows.get(nodeIndex);
  if (row !== undefined) {
    resetRowFlash(row);
  }
}

async function openRecordInspectorForChangeId(context: TimelineRenderContext, changeId: string): Promise<void> {
  const located = await findTranscriptLineForChangeId(context, changeId);
  // Synthetic changeIds (user-edit / evidence splices) match no JSONL line.
  if (located === undefined) {
    openInspectorPane().append(
      createElement("div", { class: "muted", text: "no transcript line for this revision (synthetic change id)" }),
    );
    return;
  }
  openTranscriptInspectorSynced(context, located);
}

export function createTimelineRenderContext(inputs: TimelineContextInputs): TimelineRenderContext {
  const { project, nodes, reconstructionDocument } = inputs;
  const context: TimelineRenderContext = {
    ...inputs,
    pickBoxes: new Map<number, HTMLInputElement>(),
    nodeRows: new Map<number, HTMLElement>(),
    previewPanes: new Map<number, HTMLElement>(),
    expandableRows: [],
    lineLabels: new Map<number, string>(),
    chipLineLocations: new Map<string, TranscriptLocation>(),
    laneRuns: computeGraphLaneRuns(nodes),
    selectedRow: null,
    fileNavReferenceIndex: -1,
    pickedIndexes: [],
    activeChip: null,
    cachedPatch: { key: "", text: "" },
    selectTimelineRow: (nodeIndex: number) => selectTimelineRow(context, nodeIndex),
    jumpToTimelineRow: (nodeIndex: number) => moveToTimelineRow(context, nodeIndex),
    openNodeInspector: (nodeIndex: number) => openNodeInspector(context, nodeIndex),
    clearActiveChip: () => clearActiveChip(context),
    markChipActive: (chipElement: HTMLElement) => markChipActive(context, chipElement),
    updateSelectbar: () => updateSelectbar(context),
    refreshFileNavButtons: () => {}, // no-op until attachFileNavButtons runs
    updateToggleLabel: () => {}, // no-op until attachToggleAllButton runs
    detailsContext: {
      project,
      document: reconstructionDocument,
      nodes,
      openNodeInspector: (nodeIndex: number) => openNodeInspector(context, nodeIndex),
      selectTimelineRow: (nodeIndex: number) => void selectTimelineRowAndFlash(context, nodeIndex),
      // Opening a rev card's causing record fills only the right column, so rev cards stay visible.
      openRecordForChangeId: (changeId: string) => void openRecordInspectorForChangeId(context, changeId),
      fetchRangePatch: (fromStep: number, toStep: number) => fetchRangePatch(context, fromStep, toStep),
    },
  };
  return context;
}

// Task 92: resolve nodes and chips to the transcript lines that caused them.

import { fetchRawRecords } from "../app-fetch.ts";
import { findLineForChangeId } from "./file-history-model.ts";
import { findJsonlForSession } from "./timeline-sessions.ts";
import type { TimelineRenderContext } from "./timeline-render-context.ts";
import type { FileChange, TranscriptLocation } from "./timeline-node-types.ts";

// Probe all project JSONLs for the transcript line carrying a changeId.
export async function findTranscriptLineForChangeId(context: TimelineRenderContext, changeId: string): Promise<TranscriptLocation | undefined> {
  for (const file of context.listing?.jsonlFiles ?? []) {
    const rawLines = await fetchRawRecords(context.project, file.fileName);
    const line = findLineForChangeId(rawLines, changeId);
    if (line >= 0) {
      return { jsonlName: file.fileName, rawLines, line };
    }
  }
  return undefined;
}

// Resolve each turn's JSONL line label up front, one cached fetch per session.
export async function loadLineLabels(context: TimelineRenderContext): Promise<void> {
  for (const [index, node] of context.nodes.entries()) {
    if (node.uuid === undefined) {
      continue;
    }
    const jsonlName = findJsonlForSession(context.listing, node.sessionId);
    if (jsonlName === undefined) {
      continue;
    }
    const rawLines = await fetchRawRecords(context.project, jsonlName);
    const line = findLineForChangeId(rawLines, `"uuid":"${node.uuid}"`);
    if (line < 0) {
      continue;
    }
    // Numbered like the details pane's "line n / max" (0-based, max index).
    context.lineLabels.set(index, `L:${line} (of ${rawLines.length - 1})`);
  }
}

// Locate one chip's causing record and store under its nodeIndex:path key.
async function loadChipLineLocationForChange(context: TimelineRenderContext, index: number, change: FileChange): Promise<void> {
  if (change.changeId === undefined) {
    return;
  }
  const located = await findTranscriptLineForChangeId(context, change.changeId);
  if (located === undefined) {
    return;
  }
  context.chipLineLocations.set(`${index}:${change.path}`, located);
}

// Item 55: resolve each chip's causing-line location; synthetics fall back to the turn's line.
export async function loadChipLineLocations(context: TimelineRenderContext): Promise<void> {
  for (const [index, node] of context.nodes.entries()) {
    for (const change of node.fileChanges ?? []) {
      await loadChipLineLocationForChange(context, index, change);
    }
  }
}

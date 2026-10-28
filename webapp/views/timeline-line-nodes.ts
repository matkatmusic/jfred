// The "show every JSONL line" toggle: one timeline row per transcript record not already a row.

import type { WireTimelineDocument } from "./timeline-wire-types.ts";

export const LINE_NODE_KIND = "jsonl-line";
const ALL_LINES_STORAGE_KEY = "timeline:allLines";
const ALL_LINES_ON_VALUE = "1";

// The engine's per-line verdict on the wire; optional because older cached documents lack it.
export type WireLineVerdict = {
  line: number;
  uuid?: string;
  type: string;
  verdict: string;
  timestamp?: string;
  sessionId?: string;
  // task 160: the record's transcript file + 1-based line (RecordSource server-side) — absent on pre-task-160 cached documents.
  source?: { filePath: string; lineNumber: number };
};

// One raw-transcript-line row; other node kinds' fields are `?: undefined` so union access stays legal.
export type LineNode = {
  kind: typeof LINE_NODE_KIND;
  when: string;
  sessionId: string | undefined;
  uuid?: string;
  text: string;
  // The row's transcript file basename and 0-based raw-line index; the { } button opens it directly.
  sourceJsonlName: string | undefined;
  sourceLineIndex: number | undefined;
  stepNumber?: undefined;
  isSystem?: undefined;
  isOrphaned?: undefined;
  isGitBaseline?: undefined;
  snapshots?: undefined;
  gitOperations?: undefined;
  fileChanges?: undefined;
  detail?: undefined;
  resultHash?: undefined;
  isError?: undefined;
  summary?: undefined;
  toolName?: undefined;
  toolUseId?: undefined;
  scriptRun?: undefined;
};

// A verdict line gets its own row unless a turn or tool-call row already shows that record.
function isLineNeedingOwnRow(verdict: WireLineVerdict, representedUuids: Set<string>): boolean {
  if (verdict.uuid === undefined) {
    return true;
  }
  return !representedUuids.has(verdict.uuid);
}

// One node per not-yet-represented transcript line; timestamp-less records sort to the top via when="".
// ponytail: label resolution downstream is O(rows×lines); precompute a uuid→line map per file if toggling large projects drags.
export function computeLineNodes(document: WireTimelineDocument): LineNode[] {
  const representedUuids = new Set<string>();
  for (const message of document.messages) {
    representedUuids.add(message.uuid);
  }
  for (const call of document.toolCalls ?? []) {
    representedUuids.add(call.uuid);
  }
  const lineNodes: LineNode[] = [];
  for (const verdict of document.lineVerdicts ?? []) {
    const needsOwnRow = isLineNeedingOwnRow(verdict, representedUuids);
    if (!needsOwnRow) {
      continue;
    }
    lineNodes.push({
      kind: LINE_NODE_KIND,
      when: verdict.timestamp ?? "",
      sessionId: verdict.sessionId,
      uuid: verdict.uuid,
      text: `${verdict.type} · ${verdict.verdict}`,
      sourceJsonlName: verdict.source === undefined ? undefined : verdict.source.filePath.split("/").pop(),
      // ponytail: lineNumber-1 assumes no blank lines in the .jsonl; renumber against raw text if blanks appear.
      sourceLineIndex: verdict.source === undefined ? undefined : verdict.source.lineNumber - 1,
    });
  }
  return lineNodes;
}

// The toggle's persisted state (sessionStorage, the task-56 precedent): default off.
export function isAllLinesOn(): boolean {
  return sessionStorage.getItem(ALL_LINES_STORAGE_KEY) === ALL_LINES_ON_VALUE;
}

export function toggleAllLinesSetting(): void {
  const allLinesAreOn = isAllLinesOn();
  if (allLinesAreOn) {
    sessionStorage.removeItem(ALL_LINES_STORAGE_KEY);
    return;
  }
  sessionStorage.setItem(ALL_LINES_STORAGE_KEY, ALL_LINES_ON_VALUE);
}

// Sessions-sidebar and fork-lane view-model (split from timeline.ts, task 92).

import { computeSessionShortLabel } from "./timeline-labels.ts";
import { LINE_NODE_KIND } from "./timeline-line-nodes.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND } from "./timeline-types.ts";
import type { TimelineNode } from "./timeline-node-types.ts";

// The /api/projects listing shape this sidebar joins sessions against.
export type WireJsonlFile = { fileName: string };
export type WireProjectListing = { name: string; jsonlFiles: WireJsonlFile[] };

// JSONLs are named after their session uuid, so a prefix match identifies the file.
export function findJsonlForSession(listing: WireProjectListing | undefined, sessionId: string | undefined): string | undefined {
  if (sessionId === undefined) {
    return undefined;
  }
  for (const file of listing?.jsonlFiles ?? []) {
    const isSessionFile = file.fileName.startsWith(sessionId);
    if (isSessionFile) {
      return file.fileName;
    }
  }
  return undefined;
}

// One entry per distinct attributed session, in first-appearance order.
export type SessionSidebarEntry = {
  sessionId: string;
  shortLabel: string;
  jsonlFileName: string | undefined;
  rowCount: number;
  firstNodeIndex: number;
};

// Unattributed rows belong to no session; the first row index is remembered for flash-scroll.
export function buildSessionsSidebarViewModel(nodes: TimelineNode[], listing: WireProjectListing | undefined): SessionSidebarEntry[] {
  const entries: SessionSidebarEntry[] = [];
  const entriesBySessionId = new Map<string, SessionSidebarEntry>();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    if (node.sessionId === undefined) {
      continue;
    }
    const existing = entriesBySessionId.get(node.sessionId);
    if (existing !== undefined) {
      existing.rowCount += 1;
      continue;
    }
    const entry: SessionSidebarEntry = {
      sessionId: node.sessionId,
      shortLabel: computeSessionShortLabel(node.sessionId),
      jsonlFileName: findJsonlForSession(listing, node.sessionId),
      rowCount: 1,
      firstNodeIndex: index,
    };
    entriesBySessionId.set(node.sessionId, entry);
    entries.push(entry);
  }
  return entries;
}

// One span per contiguous run of orphaned rows: first row draws the fork curve, last the merge-back end.
export function computeGraphLaneRuns(nodes: TimelineNode[]): { startIndex: number; endIndex: number }[] {
  const runs: { startIndex: number; endIndex: number }[] = [];
  let currentRun: { startIndex: number; endIndex: number } | undefined;
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index]!.isOrphaned !== true) {
      currentRun = undefined;
      continue;
    }
    if (currentRun !== undefined) {
      currentRun.endIndex = index;
      continue;
    }
    currentRun = { startIndex: index, endIndex: index };
    runs.push(currentRun);
  }
  return runs;
}

// Task 158: last row of a rewound branch, scoped to one session so later rows cannot mask it.
export function isNodeAbandonedBranchTip(nodes: TimelineNode[], index: number): boolean {
  const node = nodes[index]!;
  if (node.isOrphaned !== true) {
    return false;
  }
  for (let next = index + 1; next < nodes.length; next += 1) {
    if (nodes[next]!.sessionId === node.sessionId) {
      return nodes[next]!.isOrphaned !== true;
    }
  }
  return true;
}

// Commit and session-end rows are thin one-liners; the merged git baseline row expands for file chips (task 121).
export function isRowExpandable(node: TimelineNode): boolean {
  if (node.kind === COMMIT_NODE_KIND) {
    return node.isGitBaseline === true;
  }
  // Task 134: raw-line rows are thin one-liners like the pre-filter-chips view.
  if (node.kind === LINE_NODE_KIND) {
    return false;
  }
  return node.kind !== SESSION_END_NODE_KIND;
}

// Task 85's header Prev/Next: fromIndex -1 means "before the first row".
export function findAdjacentFileTouchedIndex(nodes: TimelineNode[], fromIndex: number, direction: 1 | -1): number | undefined {
  for (let index = fromIndex + direction; index >= 0 && index < nodes.length; index += direction) {
    const node = nodes[index]!;
    const isAgentTurn = node.kind === AGENT_TURN_NODE_KIND;
    const hasFileChanges = (node.fileChanges ?? []).length > 0;
    const isFileTouchingTurn = isAgentTurn && hasFileChanges;
    if (isFileTouchingTurn) {
      return index;
    }
  }
  return undefined;
}

// Commits are repo events with no record; a synthetic git baseline node has no transcript line (task 135).
export function isRowCarryingJsonRecordButton(node: TimelineNode): boolean {
  if (node.kind === COMMIT_NODE_KIND) {
    return false;
  }
  // Task 160: uuid-less raw lines (summaries) open by source line instead of a uuid scan.
  if (node.kind === LINE_NODE_KIND) {
    return true;
  }
  return node.uuid !== undefined;
}

// Task 131's header line-stepper; undefined means already at the end.
export function findAdjacentRowIndex(nodes: TimelineNode[], fromIndex: number, direction: 1 | -1): number | undefined {
  const target = fromIndex + direction;
  if (target < 0) {
    return undefined;
  }
  if (target >= nodes.length) {
    return undefined;
  }
  return target;
}

// Assigned by first appearance so a session keeps its color for the whole list.
export const SESSION_LANE_VARIABLES = ["--accent", "--green", "--orange", "--lane-violet", "--lane-teal"];
export const ORPHAN_LANE_COLOR = "var(--muted)";

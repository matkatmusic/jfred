// Sessions-sidebar, fork-lane, and build-progress view-model (split from timeline.ts, task 92):
// grouping timeline rows by session, the orphan lane runs, row expandability, Prev/Next file
// navigation, and the large-timeline progress-overlay math (item 78).

import { computeSessionShortLabel } from "./timeline-labels.ts";
import { LINE_NODE_KIND } from "./timeline-line-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    type TimelineNode,
} from "./timeline-types.ts";

// The /api/projects listing shape this sidebar joins sessions against (moved from
// timeline-types.ts — this module is its only consumer).
export type WireJsonlFile = { fileName: string };
export type WireProjectListing = { name: string; jsonlFiles: WireJsonlFile[] };

// The project JSONL whose file name starts with the session id (JSONLs are named after their
// session uuid); undefined when unattributed or when the listing has no match. Lifted out of
// renderTimelineView (item 66) so the Sessions sidebar view-model can resolve it too.
export function findJsonlForSession(listing: WireProjectListing | undefined, sessionId: string | undefined): string | undefined {
    if (sessionId === undefined) {
        return undefined;
    }
    return listing?.jsonlFiles.find((file) => file.fileName.startsWith(sessionId))?.fileName;
}

// One Sessions-sidebar entry per distinct attributed session, in first-appearance order.
export type SessionSidebarEntry = {
    sessionId: string;
    shortLabel: string;
    jsonlFileName: string | undefined;
    rowCount: number;
    firstNodeIndex: number;
};

// The Sessions sidebar's entries (item 66): group the timeline rows by sessionId (unattributed
// rows belong to no session), counting rows and remembering the first row for flash-scroll.
export function buildSessionsSidebarViewModel(nodes: TimelineNode[], listing: WireProjectListing | undefined): SessionSidebarEntry[] {
    const entries: SessionSidebarEntry[] = [];
    const entriesBySessionId = new Map<string, SessionSidebarEntry>();
    nodes.forEach((node, index) => {
        if (node.sessionId === undefined) {
            return;
        }
        const existing = entriesBySessionId.get(node.sessionId);
        if (existing !== undefined) {
            existing.rowCount += 1;
            return;
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
    });
    return entries;
}

// The fork gutter's lane-2 spans (item 66): one {startIndex, endIndex} per CONTIGUOUS run of
// orphaned rows — the run's first row draws the fork curve, its last the merge-back end.
export function computeGraphLaneRuns(nodes: TimelineNode[]): { startIndex: number; endIndex: number }[] {
    const runs: { startIndex: number; endIndex: number }[] = [];
    let currentRun: { startIndex: number; endIndex: number } | undefined;
    nodes.forEach((node, index) => {
        if (node.isOrphaned !== true) {
            currentRun = undefined;
            return;
        }
        if (currentRun !== undefined) {
            currentRun.endIndex = index;
            return;
        }
        currentRun = { startIndex: index, endIndex: index };
        runs.push(currentRun);
    });
    return runs;
}

// task 158: the LAST row of an abandoned (rewound) branch — an orphaned node whose next node
// of the SAME session is not orphaned, or that has no later same-session node. Same-session
// scoping so an interleaved surviving session's row landing after the tip can't mask it.
export function checkNodeIsAbandonedBranchTip(nodes: TimelineNode[], index: number): boolean {
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

// Whether a row gets a tri + bubble (item 66): commit and session-end rows are thin one-liners
// (locked decision 4); every turn and tool-call row expands. The one commit exception (task
// 121): the merged git-derived baseline row expands to show its file chips.
export function checkRowIsExpandable(node: TimelineNode): boolean {
    if (node.kind === COMMIT_NODE_KIND) {
        return node.isGitBaseline === true;
    }
    // task 134: raw-line rows are thin one-liners like the pre-filter-chips view.
    if (node.kind === LINE_NODE_KIND) {
        return false;
    }
    return node.kind !== SESSION_END_NODE_KIND;
}

// Nearest agent turn carrying file chips, walking from fromIndex in direction (task 85's
// header Prev/Next). fromIndex -1 means "before the first row"; undefined means no
// candidate in that direction.
export function findAdjacentFileTouchedIndex(
    nodes: TimelineNode[],
    fromIndex: number,
    direction: 1 | -1,
): number | undefined {
    for (let index = fromIndex + direction; index >= 0 && index < nodes.length; index += direction) {
        const node = nodes[index]!;
        if (node.kind === AGENT_TURN_NODE_KIND && (node.fileChanges ?? []).length > 0) {
            return index;
        }
    }
    return undefined;
}

// A row's { } button opens its JSONL record — commits are repo events with no record, and a
// synthetic node (the git-derived baseline turn, task 135) has no transcript line behind it.
export function checkRowCarriesJsonRecordButton(node: TimelineNode): boolean {
    if (node.kind === COMMIT_NODE_KIND) {
        return false;
    }
    if (node.uuid === undefined) {
        return false;
    }
    return true;
}

// The next/previous visible row, one step at a time (task 131's header line-stepper — with the
// task-134 all-lines toggle on this is one JSONL line per click). undefined = already at the end.
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

// Fixed session-lane palette, assigned by first appearance; a session keeps its color for the
// whole list (never re-cycled mid-list).
export const SESSION_LANE_VARIABLES = ["--accent", "--green", "--orange", "--lane-violet", "--lane-teal"];
export const ORPHAN_LANE_COLOR = "var(--muted)";

// A timeline this many rows or larger gets the build-progress overlay + chunked
// rendering; smaller ones build synchronously (item 78). Exported so the boundary
// tests track this value instead of hardcoding it (it is tuned in place).
export const LARGE_TIMELINE_ROW_COUNT = 100;

// Rows built per animation frame during a chunked (large-timeline) build.
export const TIMELINE_BUILD_BATCH_SIZE = 10;

// True when a timeline is large enough to build in yielding batches behind a
// progress overlay instead of one synchronous pass.
export function checkTimelineNeedsProgressOverlay(rowCount: number): boolean {
    return rowCount >= LARGE_TIMELINE_ROW_COUNT;
}

// The overlay's text line, e.g. "Building timeline… 250 / 1200 rows".
export function computeTimelineBuildProgressLabel(rowsBuilt: number, totalRows: number): string {
    return `Building timeline… ${rowsBuilt} / ${totalRows} rows`;
}

// The progress bar's fill fraction (0..1). A zero total counts as fully built (1)
// so an empty build never divides by zero.
export function computeTimelineProgressFraction(rowsBuilt: number, totalRows: number): number {
    if (totalRows === 0) {
        return 1;
    }
    return rowsBuilt / totalRows;
}

// Resolve on the next animation frame so a just-applied DOM update paints before
// the next batch of rows blocks the main thread again (item 78).
export function waitForNextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

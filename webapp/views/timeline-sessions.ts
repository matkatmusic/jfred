// Sessions-sidebar, fork-lane, and build-progress view-model (split from timeline.ts, task 92).

import { computeSessionShortLabel } from "./timeline-labels.ts";
import { LINE_NODE_KIND } from "./timeline-line-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    type TimelineNode,
} from "./timeline-types.ts";

// The /api/projects listing shape this sidebar joins sessions against.
export type WireJsonlFile = { fileName: string };
export type WireProjectListing = { name: string; jsonlFiles: WireJsonlFile[] };

// JSONLs are named after their session uuid, so a prefix match identifies the file.
export function findJsonlForSession(listing: WireProjectListing | undefined, sessionId: string | undefined): string | undefined {
    if (sessionId === undefined) {
        return undefined;
    }
    return listing?.jsonlFiles.find((file) => file.fileName.startsWith(sessionId))?.fileName;
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

// One span per contiguous run of orphaned rows: first row draws the fork curve, last the merge-back end.
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

// Task 158: last row of a rewound branch, scoped to the same session so it can't be masked later.
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

// Commit/session-end rows are thin one-liners; the merged git-derived baseline row is the exception, expanding for file chips (task 121).
export function checkRowIsExpandable(node: TimelineNode): boolean {
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

// Commits are repo events with no record; a synthetic git-derived baseline node has no transcript line either (task 135).
export function checkRowCarriesJsonRecordButton(node: TimelineNode): boolean {
    if (node.kind === COMMIT_NODE_KIND) {
        return false;
    }
    // Task 160: uuid-less raw lines (summaries) open by source line instead of a uuid scan.
    if (node.kind === LINE_NODE_KIND) {
        return true;
    }
    if (node.uuid === undefined) {
        return false;
    }
    return true;
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

// Exported so the boundary tests track this tuned-in-place value instead of hardcoding it.
export const LARGE_TIMELINE_ROW_COUNT = 100;

// Rows built per animation frame during a chunked (large-timeline) build.
export const TIMELINE_BUILD_BATCH_SIZE = 10;

export function checkTimelineNeedsProgressOverlay(rowCount: number): boolean {
    return rowCount >= LARGE_TIMELINE_ROW_COUNT;
}

export function computeTimelineBuildProgressLabel(rowsBuilt: number, totalRows: number): string {
    return `Building timeline… ${rowsBuilt} / ${totalRows} rows`;
}

// A zero total counts as fully built so an empty build never divides by zero.
export function computeTimelineProgressFraction(rowsBuilt: number, totalRows: number): number {
    if (totalRows === 0) {
        return 1;
    }
    return rowsBuilt / totalRows;
}

// Resolve next frame so a just-applied DOM update paints before the next row batch blocks main thread (item 78).
export function waitForNextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

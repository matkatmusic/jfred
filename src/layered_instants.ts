// Shared UTC-ms axis: JSONL lands as ms, git widens from seconds, same-second ties use Q7/Q9 content order.

import { LayeredNodeKind } from "./structures/vocabulary.ts";
import type { Instant, TimelineNode } from "./layered_types.ts";

// Widens a git epoch-second stamp onto the shared UTC-ms axis.
export function widenEpochSecondsToInstant(epochSeconds: number): Instant {
    return new Date(epochSeconds * 1000);
}

// The sortable view of a timeline node.
export interface AxisPlacement {
    instant: Instant;
    // Widened from git seconds; same-second pairs need Q7/Q9 content-order tiebreak.
    widenedFromSeconds: boolean;
    // Full content when the node carries it (beacon/end-state); undefined otherwise.
    content: string | undefined;
}

// The epoch second an instant falls in.
function computeEpochSecond(placement: AxisPlacement): number {
    return Math.floor(placement.instant.getTime() / 1000);
}

// True when exactly one side is widened and both share the same epoch second.
function checkNeedsContentTiebreak(a: AxisPlacement, b: AxisPlacement): boolean {
    if (computeEpochSecond(a) !== computeEpochSecond(b)) {
        return false;
    }
    return a.widenedFromSeconds !== b.widenedFromSeconds;
}

// Equal content = corroboration (widened after ms); different = widened before ms.
// ponytail: single-change-per-second rule; refine with multi-change chains if a real corpus contradicts it.
function compareByContentOrder(a: AxisPlacement, b: AxisPlacement): number {
    const widenedSortsAfter = a.content === b.content;
    if (a.widenedFromSeconds) {
        return widenedSortsAfter ? 1 : -1;
    }
    return widenedSortsAfter ? -1 : 1;
}

// Primary comparator; stable sort preserves source order for equal-ms ties.
export function compareAxisPlacements(a: AxisPlacement, b: AxisPlacement): number {
    const tiebreakApplies = checkNeedsContentTiebreak(a, b)
        && a.content !== undefined
        && b.content !== undefined;
    if (tiebreakApplies) {
        return compareByContentOrder(a, b);
    }
    return a.instant.getTime() - b.instant.getTime();
}

// Builds an ms-precision axis placement for a JSONL node.
function makeJsonlAxisPlacement(node: TimelineNode): AxisPlacement {
    return {
        instant: node.instant,
        widenedFromSeconds: false,
        content: node.kind === LayeredNodeKind.beacon ? node.content : undefined,
    };
}

// Sorts nodes onto the shared instant axis for S1 loader and S5 merge.
export function sortNodesOntoAxis(nodes: TimelineNode[]): TimelineNode[] {
    return nodes
        .map((node) => ({ node, placement: makeJsonlAxisPlacement(node) }))
        .sort((a, b) => compareAxisPlacements(a.placement, b.placement))
        .map((entry) => entry.node);
}


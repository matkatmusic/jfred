// Instant axis placement (task 197, spec S1): every layered timeline node sits on ONE shared
// UTC-ms axis. JSONL timestamps land as-is (ms, the master clock); git committer times arrive
// in whole seconds and are widened ×1000; a commit and a JSONL row in the same second cannot be
// ordered by clock (the commit's true moment is anywhere inside that second), so the Q7/Q9
// content-order tiebreak decides.

import { LayeredNodeKind } from "./structures/vocabulary.ts";
import type { Instant, TimelineNode } from "./layered_types.ts";

// Git committer time (epoch seconds, never author time) widened onto the shared UTC-ms axis.
export function widenCommitterSecondsToInstant(committerEpochSeconds: number): Instant {
    return new Date(committerEpochSeconds * 1000);
}

// The sortable view of a timeline node.
export interface AxisPlacement {
    instant: Instant;
    // True when the instant was widened from git committer seconds — its true moment is
    // anywhere inside that second, so same-second comparisons against ms-precision JSONL
    // instants must fall back to content order (hpp Q7/Q9).
    widenedFromSeconds: boolean;
    // Full content when the node carries it (beacon/end-state); undefined otherwise.
    content: string | undefined;
}

// The epoch second an instant falls in.
function computeEpochSecond(placement: AxisPlacement): number {
    return Math.floor(placement.instant.getTime() / 1000);
}

// Whether the pair needs the content-order tiebreak: same second, and exactly one side widened
// (two ms-precision instants order by ms; two widened instants share the whole second anyway).
function checkNeedsContentTiebreak(a: AxisPlacement, b: AxisPlacement): boolean {
    if (computeEpochSecond(a) !== computeEpochSecond(b)) {
        return false;
    }
    return a.widenedFromSeconds !== b.widenedFromSeconds;
}

// The Q7/Q9 content-order rule for a same-second widened-vs-ms pair, given both contents:
// equal content -> the commit blob snapshotted the state the JSONL row produced, so the widened
// node sorts AFTER the ms node (corroboration); differing content -> had the commit happened
// after the JSONL change its blob would hold that content, so the widened node sorts BEFORE.
// ponytail: single-change-per-second rule; refine with multi-change chains if a real corpus contradicts it.
function compareByContentOrder(a: AxisPlacement, b: AxisPlacement): number {
    const widenedSortsAfter = a.content === b.content;
    if (a.widenedFromSeconds) {
        return widenedSortsAfter ? 1 : -1;
    }
    return widenedSortsAfter ? -1 : 1;
}

// The one comparator every layered timeline sort uses. Exact-ms same-precision ties compare
// equal so a STABLE sort preserves source (line) order — which is content order in a session.
export function compareAxisPlacements(a: AxisPlacement, b: AxisPlacement): number {
    const tiebreakApplies = checkNeedsContentTiebreak(a, b)
        && a.content !== undefined
        && b.content !== undefined;
    if (tiebreakApplies) {
        return compareByContentOrder(a, b);
    }
    return a.instant.getTime() - b.instant.getTime();
}

// The sortable axis view of one node (JSONL rows are ms-precision — the widened-seconds flag
// arrives with git beacons in layer 2/task 200).
function makeJsonlAxisPlacement(node: TimelineNode): AxisPlacement {
    return {
        instant: node.instant,
        widenedFromSeconds: false,
        content: node.kind === LayeredNodeKind.beacon ? node.content : undefined,
    };
}

// Sort one timeline's nodes onto the shared instant axis. Shared by the S1 loader
// (layered_load.ts) and the S5 merge (layered_merge.ts) — one sort, one axis.
export function sortNodesOntoAxis(nodes: TimelineNode[]): TimelineNode[] {
    return nodes
        .map((node) => ({ node, placement: makeJsonlAxisPlacement(node) }))
        .sort((a, b) => compareAxisPlacements(a.placement, b.placement))
        .map((entry) => entry.node);
}

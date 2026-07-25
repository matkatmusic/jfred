// Task 199 (spec S2): layer-1 timeline completion — the file's on-disk end state appended as
// the timeline's FINAL node, and a presumed-user-edit gap inserted between adjacent verified
// states with differing content (Q8 invariant: an unexplained diff is presumed a user edit;
// the engine may leave a gap but may never invent an attribution).

import { existsSync, readFileSync, statSync } from "node:fs";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import { checkNodeCarriesBytes } from "./layered_anchor.ts";
import type { BeaconNode, EndStateNode, TimelineNode } from "./layered_types.ts";

// The file's current on-disk bytes as its timeline's final node (spec S2), or undefined when
// the file no longer exists on disk (a vanished file has no end state to verify). Instant =
// disk mtime — recorded evidence, never "now" (Q7).
export function buildEndStateNode(filename: Path): EndStateNode | undefined {
    if (!existsSync(filename.toString())) {
        return undefined;
    }
    return {
        kind: LayeredNodeKind.endState,
        instant: statSync(filename.toString()).mtime,
        content: readFileSync(filename.toString(), "utf8"),
    };
}

// The gap to insert before this verified state: one presumption node when the previous
// verified state's bytes differ, none otherwise. The gap's instant is the later state's:
// "by this instant the content had changed".
function listGapsBeforeVerifiedNode(
    previousVerified: BeaconNode | EndStateNode | undefined,
    node: BeaconNode | EndStateNode,
): TimelineNode[] {
    if (previousVerified === undefined || previousVerified.content === node.content) {
        return [];
    }
    return [{ kind: LayeredNodeKind.presumedUserEdit, instant: node.instant }];
}

// Insert a presumed-user-edit gap before each verified state whose previous verified state
// holds different bytes. Byteless stubs are skipped when pairing — a gap needs both contents
// known.
export function insertPresumedUserEditGaps(nodes: TimelineNode[]): TimelineNode[] {
    const completed: TimelineNode[] = [];
    let previousVerified: BeaconNode | EndStateNode | undefined;
    for (const node of nodes) {
        if (checkNodeCarriesBytes(node)) {
            completed.push(...listGapsBeforeVerifiedNode(previousVerified, node));
            previousVerified = node;
        }
        completed.push(node);
    }
    return completed;
}

// The completed layer-1 timeline: sorted evidence nodes, then the on-disk end state appended
// POSITIONALLY as the final node (spec S2 wording — not sort-inserted), then presumption gaps.
export function completeLayer1Timeline(nodes: TimelineNode[], filename: Path): TimelineNode[] {
    const endState = buildEndStateNode(filename);
    const withEndState = endState === undefined ? nodes : [...nodes, endState];
    return insertPresumedUserEditGaps(withEndState);
}

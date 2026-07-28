// Layer-1 timeline completion: append on-disk end state, insert presumed-user-edit gaps (spec S2/Q8).

import { readFileSync, statSync } from "node:fs";
import { LayeredNodeKind } from "./structures/vocabulary.ts";
import type { Path } from "./structures/domain.ts";
import { checkNodeCarriesBytes } from "./layered_anchor.ts";
import type { BeaconNode, EndStateNode, TimelineNode } from "./layered_types.ts";

// Spec S2 final node from disk; instant = mtime not "now" (Q7).
export function buildEndStateNode(filename: Path): EndStateNode | undefined {
    // A missing path has no end state; a directory (a real-data shape) has no file bytes.
    const stats = statSync(filename.toString(), { throwIfNoEntry: false });
    if (stats === undefined || !stats.isFile()) {
        return undefined;
    }
    return {
        kind: LayeredNodeKind.endState,
        instant: stats.mtime,
        content: readFileSync(filename.toString(), "utf8"),
    };
}

// Emits a presumed-user-edit gap when previous verified content differs.
function listGapsBeforeVerifiedNode(
    previousVerified: BeaconNode | EndStateNode | undefined,
    node: BeaconNode | EndStateNode,
): TimelineNode[] {
    if (previousVerified === undefined || previousVerified.content === node.content) {
        return [];
    }
    return [{ kind: LayeredNodeKind.presumedUserEdit, instant: node.instant }];
}

// Q8: unexplained content diffs become presumed-user-edit gaps.
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

// End state appended positionally (spec S2), then presumption gaps inserted.
export function completeLayer1Timeline(nodes: TimelineNode[], filename: Path): TimelineNode[] {
    const endState = buildEndStateNode(filename);
    const withEndState = endState === undefined ? nodes : [...nodes, endState];
    return insertPresumedUserEditGaps(withEndState);
}



// Task 259: the rounded rectangle behind a run of nodes in ONE bubble that share an instant.
//
// A commit and a file's on-disk mtime routinely land on the same instant. Task 251 stopped them overprinting by charging that instant one stacked 22 px row per tied node — but once they are on separate rows, nothing says they were simultaneous, and the fix for the collision destroyed the information. This marker restores it, anchored on the single ruler tick that instant occupies.
//
// Its own module rather than more of webapp/layer1-page.ts, which is at the repo's 250-line cap — the split pattern layer1-sources.ts / layer1-find-file.ts / layer1-zoom.ts already set.

import { el } from "./app-dom.ts";

// One ladder entry as /api/layer1-view ships it: `instant` is ISO text, `axisPx` an ABSOLUTE ruler
// offset. Declared structurally rather than imported from layer1-page.ts, which imports THIS module
// — importing back would be a cycle (webapp/views/sidebar.ts mirrors timeline-file-tree.ts's types
// for the same reason).
export interface TieGroupNode {
    instant: string;
    axisPx: number;
}

// Runs of two or more ladder nodes sharing one instant. ONE linear pass is correct because a tie is contiguous by construction: src/viewer_api_layer1.ts's listPairNodeLadder emits commits oldest-first then the on-disk node, and the axis charges tied nodes consecutive rows in that same order — so two nodes at one instant can never be separated by a node at another.
function groupTiedLadderNodes(ladder: readonly TieGroupNode[]): TieGroupNode[][] {
    const runs: TieGroupNode[][] = [];
    for (const node of ladder) {
        const currentRun = runs.at(-1);
        if (currentRun?.at(-1)?.instant === node.instant) {
            currentRun.push(node);
            continue;
        }
        runs.push([node]);
    }
    return runs.filter((run) => run.length > 1);
}

// The markers for one widget's ladder, positioned against that widget's own anchor (`startPx`, its earliest node) — the same widget-relative arithmetic layer1-page.ts does for the nodes themselves.  `--span-px` is first-node-to-last-node, so the stylesheet adds the node box's own reach and needs no knowledge of how many rows the run holds.
export function buildTieGroupMarkers(ladder: readonly TieGroupNode[], startPx: number): HTMLElement[] {
    return groupTiedLadderNodes(ladder).map((run) => {
        const marker = el("div", { class: "tiegroup" });
        marker.style.setProperty("--axis-px", String(run[0]!.axisPx - startPx));
        marker.style.setProperty("--span-px", String(run.at(-1)!.axisPx - run[0]!.axisPx));
        return marker;
    });
}

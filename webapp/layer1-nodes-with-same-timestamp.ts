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
export interface NodeWithSameTimestamp {
    instant: string;
    axisPx: number;
}

// Since task 312 snapshots follow "on disk", so a tie need not be adjacent; group by instant.
function groupTiedLadderNodes(ladder: readonly NodeWithSameTimestamp[]): NodeWithSameTimestamp[][] {
    const nodesByInstant = new Map<string, NodeWithSameTimestamp[]>();
    for (const node of ladder) {
        const group = nodesByInstant.get(node.instant) ?? [];
        group.push(node);
        nodesByInstant.set(node.instant, group);
    }
    return [...nodesByInstant.values()].filter((group) => group.length > 1);
    // const runs: NodeWithSameTimestamp[][] = [];
    // for (const node of ladder) {
    //     const currentRun = runs.at(-1);
    //     if (currentRun?.at(-1)?.instant === node.instant) {
    //         currentRun.push(node);
    //         continue;
    //     }
    //     runs.push([node]);
    // }
    // return runs.filter((run) => run.length > 1);
}

// The markers for one widget's ladder, positioned against that widget's own anchor (`startPx`, its earliest node) — the same widget-relative arithmetic layer1-page.ts does for the nodes themselves.  `--span-px` is earliest-to-latest node, so the stylesheet adds the node box's own reach and needs no knowledge of how many rows the run holds.
export function buildNodesWithSameTimestampMarkers(ladder: readonly NodeWithSameTimestamp[], startPx: number): HTMLElement[] {
    return groupTiedLadderNodes(ladder).map((run) => {
        const marker = el("div", { class: "nodes-with-same-timestamp" });
        const axisPxValues = run.map((node) => node.axisPx);
        const firstPx = Math.min(...axisPxValues);
        marker.style.setProperty("--axis-px", String(firstPx - startPx));
        marker.style.setProperty("--span-px", String(Math.max(...axisPxValues) - firstPx));
        // marker.style.setProperty("--axis-px", String(run[0]!.axisPx - startPx));
        // marker.style.setProperty("--span-px", String(run.at(-1)!.axisPx - run[0]!.axisPx));
        return marker;
    });
}

// Task 253: the Layer 1 timeline's folder filter — the view that a File Nav folder selection draws.
//
// Filtering cannot just hide bubbles. `axisPx` is an ACCUMULATED offset (webapp/layer1-ruler-axis.ts):
// every gap adds to the ones before it, so removing an instant moves every later node. Leaving the
// endpoint's offsets in place would keep the canvas at the full-project height with the dropped
// files' time still reserved as blank space — the opposite of what task 253 asks for. So the
// survivors go back through the SAME layout the endpoint ran, which is why that module lives in
// webapp/: one implementation, no chance of the filtered ruler disagreeing with the full one.
//
// Both functions here are pure view -> view: the page hands the result to its existing renderer.

import { layOutNodeLadders, type NodeLadder } from "./layer1-ruler-axis.ts";
import type { WireCommit, WireInstant, WireLayer1View, WireOrphan, WirePair } from "./layer1-wire.ts";

// The one place the wire's ISO text becomes a Date. Every instant below is round-tripped through
// this and back out with toISOString(), so the endpoint's own spelling is what the page re-emits.
function readWireInstant(text: string): Date {
    return new Date(text);
}

// One pair's ladder, in the order the page draws it: every commit oldest-first, then the on-disk
// node. Identical to src/viewer_api_layer1.ts's listPairNodeLadder, over the wire's shapes rather
// than the domain's — the order is load-bearing, because the offsets come back positionally.
function listWirePairLadder(pair: WirePair): NodeLadder {
    return [...pair.commits.map((commit) => commit.instant), pair.onDisk.instant].map(readWireInstant);
}

// A node re-placed: same instant, new offset. Spreading the node keeps `hash` on a commit without
// this needing to know which kind it was handed.
function placeNodeAtPixels<Node extends WireInstant>(node: Node, axisPx: number): Node {
    return { ...node, axisPx };
}

// Look one instant's TICK offset up — a bucket row flows inside its bucket rather than being pinned
// to the axis, so an orphan reads the tick and never a stacked node row. Every instant asked for
// here was part of the layout's own input, so a miss is a bug in this module rather than bad input:
// fail loudly instead of drawing a row at a silent zero (src/viewer_api_layer1.ts does the same).
function placeOrphanOnAxis(tickOffsetsPx: Map<number, number>, orphan: WireOrphan): WireOrphan {
    const axisPx = tickOffsetsPx.get(readWireInstant(orphan.instant).getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${orphan.instant} is missing from the re-laid-out ruler`);
    }
    return placeNodeAtPixels(orphan, axisPx);
}

// A pair's nodes taking the offsets measured for THIS pair's ladder. `nodeOffsetsPx` is parallel to
// listWirePairLadder's output, so the commits read off the front in the same oldest-first order and
// the on-disk node is the last entry — by construction, which is what lets two nodes sharing an
// instant come back on different rows.
function placePairNodesOnAxis(pair: WirePair, nodeOffsetsPx: number[]): WirePair {
    return {
        ...pair,
        commits: pair.commits.map((commit: WireCommit, node) => placeNodeAtPixels(commit, nodeOffsetsPx[node]!)),
        onDisk: placeNodeAtPixels(pair.onDisk, nodeOffsetsPx.at(-1)!),
    };
}

// Re-run the endpoint's ruler layout over whatever records this view still holds, returning a fresh
// view whose instants are unchanged and whose every offset is measured from those records alone.
// Mirrors src/viewer_api_layer1.ts's assembly: pair ladders FIRST and in `pairs` order, so
// ladderOffsetsPx[index] is pair `index`'s own rows; each orphan follows as a ONE-node ladder, so it
// still bounds the ruler without being charged a stacked row.
export function relayOutLayer1View(view: WireLayer1View): WireLayer1View {
    const layout = layOutNodeLadders([
        ...view.pairs.map(listWirePairLadder),
        ...view.gitOrphans.map((orphan) => [readWireInstant(orphan.instant)]),
        ...view.diskOrphans.map((orphan) => [readWireInstant(orphan.instant)]),
    ]);
    const tickOffsetsPx = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        pairs: view.pairs.map((pair, index) => placePairNodesOnAxis(pair, layout.ladderOffsetsPx[index]!)),
        gitOrphans: view.gitOrphans.map((orphan) => placeOrphanOnAxis(tickOffsetsPx, orphan)),
        diskOrphans: view.diskOrphans.map((orphan) => placeOrphanOnAxis(tickOffsetsPx, orphan)),
        ruler: layout.ticks.map((tick) => ({ instant: tick.instant.toISOString(), axisPx: tick.offsetPx })),
    };
}

// The view a folder selection draws. `targets` is the selected folder's LEAF paths, already resolved
// by the File Nav — an empty list means no filter and restores everything.
//
// Membership is exact, never a prefix test on the path string: the caller resolved the folder to
// whole paths, and a startsWith here would let `src/keep/a.ts` also match `src/keep/a.ts.bak` — the
// substring class of bug task 278 removed from the find-file box.
//
// The empty case still goes through the re-layout rather than returning `view` untouched: one code
// path, and the round-trip landing back on the endpoint's own offsets is the check that the page and
// the server have not drifted apart.
export function filterLayer1ViewByTargets(view: WireLayer1View, targets: readonly string[]): WireLayer1View {
    if (targets.length === 0) {
        return relayOutLayer1View(view);
    }
    const selected = new Set(targets);
    return relayOutLayer1View({
        pairs: view.pairs.filter((pair) => selected.has(pair.path)),
        gitOrphans: view.gitOrphans.filter((orphan) => selected.has(orphan.path)),
        diskOrphans: view.diskOrphans.filter((orphan) => selected.has(orphan.path)),
        // Replaced wholesale by the re-layout below; the surviving records are its only real input.
        ruler: [],
    });
}

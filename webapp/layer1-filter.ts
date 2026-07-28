// Task 253: axisPx is an accumulated offset, so filtering re-runs the SAME layout as the endpoint rather than hiding bubbles.

import { layOutNodeLadders, type NodeLadder } from "./layer1-ruler-axis.ts";
import type { WireCommit, WireInstant, WireLayer1View, WireOrphan, WirePair } from "./layer1-wire.ts";

// The one place the wire's ISO text becomes a Date, so the endpoint's own spelling is re-emitted.
function readWireInstant(text: string): Date {
    return new Date(text);
}

// Mirrors src/viewer_api_layer1.ts's listPairNodeLadder; order is load-bearing since offsets come back positionally.
function listWirePairLadder(pair: WirePair): NodeLadder {
    return [...pair.commits.map((commit) => commit.instant), pair.onDisk.instant].map(readWireInstant);
}

// Spreading keeps `hash` on a commit without this needing to know which kind it was handed.
function placeNodeAtPixels<Node extends WireInstant>(node: Node, axisPx: number): Node {
    return { ...node, axisPx };
}

// An orphan reads the TICK offset, never a stacked row; a missing instant is a bug, not a silent zero.
function placeOrphanOnAxis(tickOffsetsPx: Map<number, number>, orphan: WireOrphan): WireOrphan {
    const axisPx = tickOffsetsPx.get(readWireInstant(orphan.instant).getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${orphan.instant} is missing from the re-laid-out ruler`);
    }
    return placeNodeAtPixels(orphan, axisPx);
}

// `nodeOffsetsPx` is parallel to listWirePairLadder's output: commits oldest-first, on-disk last.
function placePairNodesOnAxis(pair: WirePair, nodeOffsetsPx: number[]): WirePair {
    return {
        ...pair,
        commits: pair.commits.map((commit: WireCommit, node) => placeNodeAtPixels(commit, nodeOffsetsPx[node]!)),
        onDisk: placeNodeAtPixels(pair.onDisk, nodeOffsetsPx.at(-1)!),
    };
}

// Mirrors src/viewer_api_layer1.ts: pair ladders come first, so ladderOffsetsPx[index] is pair index's rows; orphans follow as one-node ladders.
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
        // eventCount is re-measured here, not carried from the unfiltered view: a folder filter removes bubbles, so counts per instant shrink.
        ruler: layout.ticks.map((tick) => ({
            instant: tick.instant.toISOString(),
            axisPx: tick.offsetPx,
            eventCount: tick.eventCount,
        })),
    };
}

// `targets` holds LEAF paths (empty = no filter); membership is exact, never prefix, so `a.ts.bak` can't match `a.ts` (task 278).
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

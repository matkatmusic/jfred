// Task 253: filtering cannot just hide bubbles — `axisPx` is an ACCUMULATED offset, so removing an
// instant moves every later node and would leave the dropped files' time reserved as blank space.
// Survivors go back through the SAME layout the endpoint ran, so the two rulers cannot drift apart.

import { layOutNodeLadders, type NodeLadder } from "./layer1-ruler-axis.ts";
import type { WireCommit, WireInstant, WireLayer1View, WireOrphan, WirePair } from "./layer1-wire.ts";

// The one place the wire's ISO text becomes a Date, so the endpoint's own spelling is re-emitted.
function readWireInstant(text: string): Date {
    return new Date(text);
}

// Mirrors src/viewer_api_layer1.ts's listPairNodeLadder; the order is load-bearing because the
// offsets come back positionally.
function listWirePairLadder(pair: WirePair): NodeLadder {
    return [...pair.commits.map((commit) => commit.instant), pair.onDisk.instant].map(readWireInstant);
}

// Spreading keeps `hash` on a commit without this needing to know which kind it was handed.
function placeNodeAtPixels<Node extends WireInstant>(node: Node, axisPx: number): Node {
    return { ...node, axisPx };
}

// An orphan reads the TICK offset, never a stacked node row. Every instant asked for was the
// layout's own input, so a miss is a bug here — fail loudly rather than draw at a silent zero.
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

// Mirrors src/viewer_api_layer1.ts's assembly: pair ladders FIRST and in `pairs` order, so
// ladderOffsetsPx[index] is pair `index`'s rows; each orphan follows as a ONE-node ladder.
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
        // eventCount is re-measured by the layout above, not carried over from the unfiltered view:
        // a folder filter removes bubbles, so the events left at an instant are genuinely fewer.
        ruler: layout.ticks.map((tick) => ({
            instant: tick.instant.toISOString(),
            axisPx: tick.offsetPx,
            eventCount: tick.eventCount,
        })),
    };
}

// `targets` is the folder's already-resolved LEAF paths; empty means no filter. Membership is exact,
// never a prefix test — startsWith would let `src/keep/a.ts` match `a.ts.bak` (task 278).
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

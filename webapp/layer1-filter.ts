// Task 253: axisPx accumulates, so filtering re-runs the endpoint's SAME layout rather than hiding bubbles.

import { layOutNodeLadders, type NodeLadder, type RulerLayout } from "./layer1-ruler-axis.ts";
import { listRulerRows } from "./layer1-ruler-rows.ts";
import type { WireCommit, WireInstant, WireLayer1View, WireOrphan, WirePair, WireRulerTick } from "./layer1-wire.ts";

// Task 300: an expanded ruler row's file list, fed into layout so rows and bubbles below shift down.
export interface RulerExpansion {
    instantMs: number;
    listHeightPx: number;
}

// The one place the wire's ISO text becomes a Date, so the endpoint's own spelling is re-emitted.
function readWireInstant(text: string): Date {
    return new Date(text);
}

// Mirrors src/viewer_api_layer1.ts's listPairNodeLadder; order is load-bearing since offsets come back positionally.
function listWirePairLadder(pair: WirePair): NodeLadder {
    const created = pair.created === undefined ? [] : [pair.created.instant];
    return [...created, ...pair.commits.map((commit) => commit.instant), pair.onDisk.instant].map(readWireInstant);
}

// Spreading keeps `hash` on a commit without this needing to know which kind it was handed.
function placeNodeAtPixels<Node extends WireInstant>(node: Node, axisPx: number): Node {
    return { ...node, axisPx };
}

// An orphan reads the TICK offset, never a stacked row; a missing instant fails loudly.
function placeOrphanOnAxis(tickOffsetsPx: Map<number, number>, orphan: WireOrphan): WireOrphan {
    const axisPx = tickOffsetsPx.get(readWireInstant(orphan.instant).getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${orphan.instant} is missing from the re-laid-out ruler`);
    }
    return placeNodeAtPixels(orphan, axisPx);
}

// `nodeOffsetsPx` is parallel to listWirePairLadder's output: commits oldest-first, on-disk last.
function placePairNodesOnAxis(pair: WirePair, nodeOffsetsPx: number[]): WirePair {
    const firstCommit = pair.created === undefined ? 0 : 1;
    return {
        ...pair,
        // Spread conditionally: a `created: undefined` KEY differs from an absent one under deep equality.
        ...(pair.created === undefined ? {} : { created: placeNodeAtPixels(pair.created, nodeOffsetsPx[0]!) }),
        commits: pair.commits.map((commit: WireCommit, node) => placeNodeAtPixels(commit, nodeOffsetsPx[firstCommit + node]!)),
        onDisk: placeNodeAtPixels(pair.onDisk, nodeOffsetsPx.at(-1)!),
    };
}

// eventCount is re-measured: a folder filter removes bubbles, so counts per instant shrink.
function listRulerWire(layout: RulerLayout): WireRulerTick[] {
    return layout.ticks.map((tick) => ({
        instant: tick.instant.toISOString(),
        axisPx: tick.offsetPx,
        eventCount: tick.eventCount,
    }));
}

// Task 300: charged to the row's LAST absorbed instant, so the list opens below all of them.
function measureExpansionGapPx(draft: RulerLayout, expansion: RulerExpansion | undefined): Map<number, number> {
    const row = expansion === undefined ? undefined : listRulerRows(listRulerWire(draft))
        .find((candidate) => candidate.instants.some((instant) => readWireInstant(instant).getTime() === expansion.instantMs));
    if (row === undefined || expansion === undefined) {
        return new Map();
    }
    return new Map([[readWireInstant(row.instants.at(-1)!).getTime(), expansion.listHeightPx]]);
}

// Task 300: a draft pass learns which row absorbs the expanded instant, the real pass adds its height.
export function relayOutLayer1View(view: WireLayer1View, expansion?: RulerExpansion): WireLayer1View {
    const ladders = [
        ...view.pairs.map(listWirePairLadder),
        ...view.gitOrphans.map((orphan) => [readWireInstant(orphan.instant)]),
        ...view.diskOrphans.map((orphan) => [readWireInstant(orphan.instant)]),
    ];
    const extraGapPx = measureExpansionGapPx(layOutNodeLadders(ladders), expansion);
    const layout = layOutNodeLadders(ladders, extraGapPx);
    const tickOffsetsPx = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        pairs: view.pairs.map((pair, index) => placePairNodesOnAxis(pair, layout.ladderOffsetsPx[index]!)),
        gitOrphans: view.gitOrphans.map((orphan) => placeOrphanOnAxis(tickOffsetsPx, orphan)),
        diskOrphans: view.diskOrphans.map((orphan) => placeOrphanOnAxis(tickOffsetsPx, orphan)),
        ruler: listRulerWire(layout),
    };
}

// Task 278: `targets` holds LEAF paths (empty = no filter); matching is exact, never prefix.
export function filterLayer1ViewByTargets(view: WireLayer1View, targets: readonly string[], expansion?: RulerExpansion): WireLayer1View {
    if (targets.length === 0) {
        return relayOutLayer1View(view, expansion);
    }
    const selected = new Set(targets);
    return relayOutLayer1View({
        pairs: view.pairs.filter((pair) => selected.has(pair.path)),
        gitOrphans: view.gitOrphans.filter((orphan) => selected.has(orphan.path)),
        diskOrphans: view.diskOrphans.filter((orphan) => selected.has(orphan.path)),
        // Replaced wholesale by the re-layout below; the surviving records are its only real input.
        ruler: [],
    }, expansion);
}

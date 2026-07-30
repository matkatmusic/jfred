// Task 253: axisPx accumulates, so filtering re-runs the endpoint's SAME layout rather than hiding bubbles.

import { layOutNodeLadders, type RulerLayout } from "./layer1-ruler-axis.ts";
import { listRulerRows } from "./layer1-ruler-rows.ts";
import { listOrphanLadderInstants, listPairLadderInstants } from "./layer1-wire.ts";
import type { WireCommit, WireInstant, WireLayer1View, WireOrphan, WirePair, WireRulerTick, WireSnapshot } from "./layer1-wire.ts";

// Task 300: an expanded ruler row's file list, fed into layout so rows and bubbles below shift down.
export interface RulerExpansion {
    instantMs: number;
    listHeightPx: number;
}

// The one place the wire's ISO text becomes a Date, so the endpoint's own spelling is re-emitted.
function readWireInstant(text: string): Date {
    return new Date(text);
}

// Parallel to the snapshot ladder's output, positional not a lookup.
function placeSnapshotsOnAxis(snapshots: WireSnapshot[] | undefined, tailOffsetsPx: number[]): WireSnapshot[] {
    return (snapshots ?? []).map((snapshot, node) => placeNodeAtPixels(snapshot, tailOffsetsPx[node]!));
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
    const onDiskIndex = firstCommit + pair.commits.length;
    return {
        ...pair,
        // Spread conditionally: a `created: undefined` KEY differs from an absent one under deep equality.
        ...(pair.created === undefined ? {} : { created: placeNodeAtPixels(pair.created, nodeOffsetsPx[0]!) }),
        commits: pair.commits.map((commit: WireCommit, node) => placeNodeAtPixels(commit, nodeOffsetsPx[firstCommit + node]!)),
        onDisk: placeNodeAtPixels(pair.onDisk, nodeOffsetsPx[onDiskIndex]!),
        ...(pair.snapshots === undefined ? {} : { snapshots: placeSnapshotsOnAxis(pair.snapshots, nodeOffsetsPx.slice(onDiskIndex + 1)) }),
    };
}

// A disk orphan's own node is ladder slot 0, which IS the tick offset; its snapshots stack below it.
function placeDiskOrphanOnAxis(orphan: WireOrphan, nodeOffsetsPx: number[]): WireOrphan {
    return {
        ...placeNodeAtPixels(orphan, nodeOffsetsPx[0]!),
        ...(orphan.snapshots === undefined ? {} : { snapshots: placeSnapshotsOnAxis(orphan.snapshots, nodeOffsetsPx.slice(1)) }),
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
        ...view.pairs.map((pair) => listPairLadderInstants(pair).map(readWireInstant)),
        ...view.gitOrphans.map((orphan) => [readWireInstant(orphan.instant)]),
        ...view.diskOrphans.map((orphan) => listOrphanLadderInstants(orphan).map(readWireInstant)),
    ];
    const diskOrphanLadderBase = view.pairs.length + view.gitOrphans.length;
    const extraGapPx = measureExpansionGapPx(layOutNodeLadders(ladders), expansion);
    const layout = layOutNodeLadders(ladders, extraGapPx);
    const tickOffsetsPx = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        pairs: view.pairs.map((pair, index) => placePairNodesOnAxis(pair, layout.ladderOffsetsPx[index]!)),
        gitOrphans: view.gitOrphans.map((orphan) => placeOrphanOnAxis(tickOffsetsPx, orphan)),
        diskOrphans: view.diskOrphans.map((orphan, index) =>
            placeDiskOrphanOnAxis(orphan, layout.ladderOffsetsPx[diskOrphanLadderBase + index]!)),
        ruler: listRulerWire(layout),
    };
}

// Tasks 278+326: exact LEAF-path matching; undefined = no filter, an empty list draws an empty stage.
export function filterLayer1ViewByTargets(view: WireLayer1View, targets: readonly string[] | undefined, expansion?: RulerExpansion): WireLayer1View {
    if (targets === undefined) {
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

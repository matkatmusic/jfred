// Task 253: axisPx accumulates, so filtering re-runs the endpoint's SAME layout rather than hiding bubbles.

import { computeNodeLadderLayout, type NodeLadder, type RulerLayout } from "./layer1-ruler-axis.ts";
import { listRulerRows, type RulerRow } from "./layer1-ruler-rows.ts";
import { setDiskOrphanAxisPx, setNodeAxisPx, setPairAxisPx } from "./layer1-axis-placement.ts";
import { listOrphanLadderInstants, listPairLadderInstants } from "./layer1-wire-ladder.ts";
import type { WireLayer1View, WireOrphan, WireRulerTick } from "./layer1-wire.ts";

// Task 300: an expanded ruler row's file list, fed into layout so rows and bubbles below shift down.
export interface RulerExpansion {
  instantMs: number;
  listHeightPx: number;
}

// The one place the wire's ISO text becomes a Date, so the endpoint's own spelling is re-emitted.
function readWireInstant(text: string): Date {
  return new Date(text);
}

// An orphan reads the TICK offset, never a stacked row; a missing instant fails loudly.
function setOrphanAxisPx(tickOffsetsPx: Map<number, number>, orphan: WireOrphan): WireOrphan {
  const axisPx = tickOffsetsPx.get(readWireInstant(orphan.instant).getTime());
  if (axisPx === undefined) {
    throw new Error(`instant ${orphan.instant} is missing from the re-laid-out ruler`);
  }
  return setNodeAxisPx(orphan, axisPx);
}

// eventCount is re-measured: a folder filter removes bubbles, so counts per instant shrink.
function listRulerWire(layout: RulerLayout): WireRulerTick[] {
  const wireTicks: WireRulerTick[] = [];
  for (const tick of layout.ticks) {
    wireTicks.push({
      instant: tick.instant.toISOString(),
      axisPx: tick.offsetPx,
      eventCount: tick.eventCount,
    });
  }
  return wireTicks;
}

function findExpandedRow(rows: RulerRow[], instantMs: number): RulerRow | undefined {
  for (const row of rows) {
    for (const instant of row.instants) {
      const isExpanded = readWireInstant(instant).getTime() === instantMs;
      if (isExpanded) {
        return row;
      }
    }
  }
  return undefined;
}

// Task 300: charged to the row's LAST absorbed instant, so the list opens below all of them.
function measureExpansionGapPx(draft: RulerLayout, expansion: RulerExpansion | undefined): Map<number, number> {
  if (expansion === undefined) {
    return new Map();
  }
  const row = findExpandedRow(listRulerRows(listRulerWire(draft)), expansion.instantMs);
  if (row === undefined) {
    return new Map();
  }
  return new Map([[readWireInstant(row.instants.at(-1)!).getTime(), expansion.listHeightPx]]);
}

function listWireInstants(texts: string[]): Date[] {
  const instants: Date[] = [];
  for (const text of texts) {
    instants.push(readWireInstant(text));
  }
  return instants;
}

function listViewLadders(view: WireLayer1View): NodeLadder[] {
  const ladders: NodeLadder[] = [];
  for (const pair of view.pairs) {
    ladders.push(listWireInstants(listPairLadderInstants(pair)));
  }
  for (const orphan of view.gitOrphans) {
    ladders.push([readWireInstant(orphan.instant)]);
  }
  for (const orphan of view.diskOrphans) {
    ladders.push(listWireInstants(listOrphanLadderInstants(orphan)));
  }
  return ladders;
}

// Task 300: a draft pass learns which row absorbs the expanded instant, the real pass adds its height.
function computeRelaidLayer1View(view: WireLayer1View, expansion?: RulerExpansion): WireLayer1View {
  const ladders = listViewLadders(view);
  const diskOrphanLadderBase = view.pairs.length + view.gitOrphans.length;
  const extraGapPx = measureExpansionGapPx(computeNodeLadderLayout(ladders), expansion);
  const layout = computeNodeLadderLayout(ladders, extraGapPx);
  const tickOffsetsPx = new Map<number, number>();
  for (const tick of layout.ticks) {
    tickOffsetsPx.set(tick.instant.getTime(), tick.offsetPx);
  }
  const pairs = [];
  for (const [index, pair] of view.pairs.entries()) {
    pairs.push(setPairAxisPx(pair, layout.ladderOffsetsPx[index]!));
  }
  const gitOrphans = [];
  for (const orphan of view.gitOrphans) {
    gitOrphans.push(setOrphanAxisPx(tickOffsetsPx, orphan));
  }
  const diskOrphans = [];
  for (const [index, orphan] of view.diskOrphans.entries()) {
    diskOrphans.push(setDiskOrphanAxisPx(orphan, layout.ladderOffsetsPx[diskOrphanLadderBase + index]!));
  }
  return { pairs, gitOrphans, diskOrphans, ruler: listRulerWire(layout) };
}

export { computeRelaidLayer1View as relayOutLayer1View };

function filterByPath<Item extends { path: string }>(items: Item[], selected: Set<string>): Item[] {
  const kept: Item[] = [];
  for (const item of items) {
    const isSelected = selected.has(item.path);
    if (isSelected) {
      kept.push(item);
    }
  }
  return kept;
}

// Tasks 278+326: exact LEAF-path matching; undefined = no filter, an empty list draws an empty stage.
export function filterLayer1ViewByTargets(view: WireLayer1View, targets: readonly string[] | undefined, expansion?: RulerExpansion): WireLayer1View {
  if (targets === undefined) {
    return computeRelaidLayer1View(view, expansion);
  }
  const selected = new Set(targets);
  return computeRelaidLayer1View({
    pairs: filterByPath(view.pairs, selected),
    gitOrphans: filterByPath(view.gitOrphans, selected),
    diskOrphans: filterByPath(view.diskOrphans, selected),
    // Replaced wholesale by the re-layout below; the surviving records are its only real input.
    ruler: [],
  }, expansion);
}

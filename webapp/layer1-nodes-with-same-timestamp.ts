// Task 259: a rounded rectangle behind nodes in one bubble that share an instant.

import { createElement } from "./app-dom.ts";

// One ladder entry as /api/layer1-view ships it; declared here because layer1-page.ts imports this module.
export interface NodeWithSameTimestamp {
  instant: string;
  axisPx: number;
  // Task 357: set on a branch lane's node; absent on a trunk node.
  laneIndex?: number;
}

// Since task 312 snapshots follow "on disk", so a tie need not be adjacent; group by instant.
function collectTiedLadderNodes(ladder: readonly NodeWithSameTimestamp[]): NodeWithSameTimestamp[][] {
  const nodesByInstant = new Map<string, NodeWithSameTimestamp[]>();
  for (const node of ladder) {
    const group = nodesByInstant.get(node.instant) ?? [];
    group.push(node);
    nodesByInstant.set(node.instant, group);
  }
  const tiedGroups: NodeWithSameTimestamp[][] = [];
  for (const group of nodesByInstant.values()) {
    if (group.length > 1) {
      tiedGroups.push(group);
    }
  }
  return tiedGroups;
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

// Markers for one widget's ladder, positioned relative to `startPx`, the widget's earliest node.
export function buildNodesWithSameTimestampMarkers(ladder: readonly NodeWithSameTimestamp[], startPx: number): HTMLElement[] {
  const markers: HTMLElement[] = [];
  for (const run of collectTiedLadderNodes(ladder)) {
    const marker = createElement("div", { class: "nodes-with-same-timestamp" });
    const axisPxValues: number[] = [];
    const laneIndexValues: number[] = [];
    for (const node of run) {
      axisPxValues.push(node.axisPx);
      laneIndexValues.push(node.laneIndex ?? 0);
    }
    const firstPx = Math.min(...axisPxValues);
    marker.style.setProperty("--axis-px", String(firstPx - startPx));
    marker.style.setProperty("--span-px", String(Math.max(...axisPxValues) - firstPx));
    // marker.style.setProperty("--axis-px", String(run[0]!.axisPx - startPx));
    // marker.style.setProperty("--span-px", String(run.at(-1)!.axisPx - run[0]!.axisPx));
    const lanesSpanned = Math.max(...laneIndexValues);
    if (lanesSpanned > 0) {
      marker.style.setProperty("--lanes-spanned", String(lanesSpanned));
    }
    markers.push(marker);
  }
  return markers;
}

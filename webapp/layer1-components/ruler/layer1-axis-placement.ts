// Task 253: write re-laid-out pixel offsets onto wire nodes; offsets arrive positional, parallel to the ladder.

import type { WireBranch } from "../../layer1-wire-branches.ts";
import { findRejoinWithOwnSlot, listTrunkLadderInstants } from "../../layer1-wire-ladder.ts";
import type { WireCommit, WireInstant, WireOrphan, WirePair } from "../../layer1-wire.ts";

// Spreading keeps `hash` on a commit without this needing to know which kind it was handed.
export function setNodeAxisPx<Node extends WireInstant>(node: Node, axisPx: number): Node {
  return { ...node, axisPx };
}

// Parallel to the ladder's output for these nodes, positional not a lookup.
export function setNodesAxisPx<Node extends WireInstant>(nodes: Node[] | undefined, tailOffsetsPx: number[]): Node[] {
  const placedNodes: Node[] = [];
  for (const [index, node] of (nodes ?? []).entries()) {
    placedNodes.push(setNodeAxisPx(node, tailOffsetsPx[index]!));
  }
  return placedNodes;
}

// Task 357: branch holds forkAt, nodes, then a rejoin; a rejoin on a trunk node takes that node's offset.
export function setBranchAxisPx(branch: WireBranch, trunkInstants: string[], ladderOffsetsPx: number[], placedCount: number): WireBranch {
  const forkAt = setNodeAxisPx(branch.forkAt, ladderOffsetsPx[placedCount]!);
  const nodes = setNodesAxisPx(branch.nodes, ladderOffsetsPx.slice(placedCount + 1));
  if (branch.rejoinAt === undefined) {
    return { ...branch, forkAt, nodes };
  }
  const ownSlotIndex = placedCount + 1 + branch.nodes.length;
  const hasOwnSlot = findRejoinWithOwnSlot(trunkInstants, branch) !== undefined;
  const rejoinOffsetPx = hasOwnSlot ? ladderOffsetsPx[ownSlotIndex]! : ladderOffsetsPx[trunkInstants.indexOf(branch.rejoinAt.instant)]!;
  return { ...branch, forkAt, rejoinAt: setNodeAxisPx(branch.rejoinAt, rejoinOffsetPx), nodes };
}

export function setBranchesAxisPx(branches: WireBranch[], trunkInstants: string[], ladderOffsetsPx: number[]): WireBranch[] {
  let placedCount = trunkInstants.length;
  const placedBranches: WireBranch[] = [];
  for (const branch of branches) {
    placedBranches.push(setBranchAxisPx(branch, trunkInstants, ladderOffsetsPx, placedCount));
    const hasOwnSlot = findRejoinWithOwnSlot(trunkInstants, branch) !== undefined;
    placedCount += 1 + branch.nodes.length + (hasOwnSlot ? 1 : 0);
  }
  return placedBranches;
}

// Task 379 mockup, replaced by the version above: branch nodes sat flat at the ladder tail.
// function placeBranchesOnAxis(branches: WireMockBranch[], tailOffsetsPx: number[]): WireMockBranch[] {
//     let placedCount = 0;
//     return branches.map((branch) => {
//         const nodes = placeNodesOnAxis(branch.nodes, tailOffsetsPx.slice(placedCount));
//         placedCount += branch.nodes.length;
//         return { ...branch, nodes };
//     });
// }

// Snapshots, edits, script runs, tool nodes in ladder order from `tailStart`; each key is spread only when present.
export function setTailNodesAxisPx(pair: WirePair, nodeOffsetsPx: number[], tailStart: number): Pick<WirePair, "snapshots" | "edits" | "scriptRuns" | "toolNodes"> {
  const editsStart = tailStart + (pair.snapshots ?? []).length;
  const scriptRunsStart = editsStart + (pair.edits ?? []).length;
  const toolNodesStart = scriptRunsStart + (pair.scriptRuns ?? []).length;
  return {
    ...(pair.snapshots === undefined ? {} : { snapshots: setNodesAxisPx(pair.snapshots, nodeOffsetsPx.slice(tailStart)) }),
    ...(pair.edits === undefined ? {} : { edits: setNodesAxisPx(pair.edits, nodeOffsetsPx.slice(editsStart)) }),
    ...(pair.scriptRuns === undefined ? {} : { scriptRuns: setNodesAxisPx(pair.scriptRuns, nodeOffsetsPx.slice(scriptRunsStart)) }),
    ...(pair.toolNodes === undefined ? {} : { toolNodes: setNodesAxisPx(pair.toolNodes, nodeOffsetsPx.slice(toolNodesStart)) }),
  };
}

// `nodeOffsetsPx` is parallel to listWirePairLadder's output: commits oldest-first, on-disk last.
export function setPairAxisPx(pair: WirePair, nodeOffsetsPx: number[]): WirePair {
  const firstCommit = pair.created === undefined ? 0 : 1;
  const onDiskIndex = firstCommit + pair.commits.length;
  const commits: WireCommit[] = setNodesAxisPx(pair.commits, nodeOffsetsPx.slice(firstCommit));
  return {
    ...pair,
    // Spread conditionally: a `created: undefined` KEY differs from an absent one under deep equality.
    ...(pair.created === undefined ? {} : { created: setNodeAxisPx(pair.created, nodeOffsetsPx[0]!) }),
    commits,
    onDisk: setNodeAxisPx(pair.onDisk, nodeOffsetsPx[onDiskIndex]!),
    ...setTailNodesAxisPx(pair, nodeOffsetsPx, onDiskIndex + 1),
    ...(pair.branches === undefined ? {} : { branches: setBranchesAxisPx(pair.branches, listTrunkLadderInstants(pair), nodeOffsetsPx) }),
  };
}

// A disk orphan's own node is ladder slot 0, which IS the tick offset; its snapshots stack below it.
export function setDiskOrphanAxisPx(orphan: WireOrphan, nodeOffsetsPx: number[]): WireOrphan {
  return {
    ...setNodeAxisPx(orphan, nodeOffsetsPx[0]!),
    ...(orphan.snapshots === undefined ? {} : { snapshots: setNodesAxisPx(orphan.snapshots, nodeOffsetsPx.slice(1)) }),
  };
}

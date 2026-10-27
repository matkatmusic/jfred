// Task 253: write re-laid-out pixel offsets onto wire nodes; offsets arrive positional, parallel to the ladder.

import type { WireBranch } from "./layer1-wire-branches.ts";
import { findRejoinWithOwnSlot, listTrunkLadderInstants } from "./layer1-wire-ladder.ts";
import type { WireCommit, WireInstant, WireOrphan, WirePair } from "./layer1-wire.ts";

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

// Task 357: each branch holds forkAt, its nodes, then a rejoin only if no trunk node shares it.  A rejoin sharing a trunk node takes that node's offset.
export function setBranchesAxisPx(branches: WireBranch[], trunkInstants: string[], ladderOffsetsPx: number[]): WireBranch[] {
  let placedCount = trunkInstants.length;
  const placedBranches: WireBranch[] = [];
  for (const branch of branches) {
    const forkAt = setNodeAxisPx(branch.forkAt, ladderOffsetsPx[placedCount]!);
    const nodes = setNodesAxisPx(branch.nodes, ladderOffsetsPx.slice(placedCount + 1));
    placedCount += 1 + branch.nodes.length;
    if (branch.rejoinAt === undefined) {
      placedBranches.push({ ...branch, forkAt, nodes });
      continue;
    }
    const hasOwnSlot = findRejoinWithOwnSlot(trunkInstants, branch) !== undefined;
    const rejoinOffsetPx = hasOwnSlot ? ladderOffsetsPx[placedCount++]! : ladderOffsetsPx[trunkInstants.indexOf(branch.rejoinAt.instant)]!;
    placedBranches.push({ ...branch, forkAt, rejoinAt: setNodeAxisPx(branch.rejoinAt, rejoinOffsetPx), nodes });
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

// `nodeOffsetsPx` is parallel to listWirePairLadder's output: commits oldest-first, on-disk last.
export function setPairAxisPx(pair: WirePair, nodeOffsetsPx: number[]): WirePair {
  const firstCommit = pair.created === undefined ? 0 : 1;
  const onDiskIndex = firstCommit + pair.commits.length;
  const tailStart = onDiskIndex + 1;
  const editsStart = tailStart + (pair.snapshots ?? []).length;
  const scriptRunsStart = editsStart + (pair.edits ?? []).length;
  const commits: WireCommit[] = [];
  for (const [node, commit] of pair.commits.entries()) {
    commits.push(setNodeAxisPx(commit, nodeOffsetsPx[firstCommit + node]!));
  }
  return {
    ...pair,
    // Spread conditionally: a `created: undefined` KEY differs from an absent one under deep equality.
    ...(pair.created === undefined ? {} : { created: setNodeAxisPx(pair.created, nodeOffsetsPx[0]!) }),
    commits,
    onDisk: setNodeAxisPx(pair.onDisk, nodeOffsetsPx[onDiskIndex]!),
    ...(pair.snapshots === undefined ? {} : { snapshots: setNodesAxisPx(pair.snapshots, nodeOffsetsPx.slice(tailStart)) }),
    ...(pair.edits === undefined ? {} : { edits: setNodesAxisPx(pair.edits, nodeOffsetsPx.slice(editsStart)) }),
    ...(pair.scriptRuns === undefined ? {} : { scriptRuns: setNodesAxisPx(pair.scriptRuns, nodeOffsetsPx.slice(scriptRunsStart)) }),
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

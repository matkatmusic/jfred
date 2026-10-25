// The order in which a Layer 1 bubble's nodes stack, shared by the server's ruler layout and the page.

import type { WireBranchOf } from "./layer1-wire-branches.ts";
import type { WireInstantOf, WireOrphanOf, WirePairOf } from "./layer1-wire.ts";

// Trunk ladder ORDER (task 331): created, commits, on-disk, snapshots, edits (task 343), script runs; raw `I`.
export function listTrunkLadderInstants<I, P, U>(pair: WirePairOf<I, P, U>): I[] {
  const instants: I[] = [];
  if (pair.created !== undefined) {
    instants.push(pair.created.instant);
  }
  for (const commit of pair.commits) {
    instants.push(commit.instant);
  }
  instants.push(pair.onDisk.instant);
  for (const snapshot of pair.snapshots ?? []) {
    instants.push(snapshot.instant);
  }
  for (const edit of pair.edits ?? []) {
    instants.push(edit.instant);
  }
  for (const run of pair.scriptRuns ?? []) {
    instants.push(run.instant);
  }
  return instants;
}

// Task 357: a rejoin on a trunk instant reuses that node's slot; one on no trunk node (its edit is not loaded) owns a slot.
export function findRejoinWithOwnSlot<I, U>(trunkInstants: readonly I[], branch: WireBranchOf<I, U>): WireInstantOf<I> | undefined {
  if (branch.rejoinAt === undefined) {
    return undefined;
  }
  const isOnTrunk = trunkInstants.includes(branch.rejoinAt.instant);
  return isOnTrunk ? undefined : branch.rejoinAt;
}

// Pair ladder ORDER: the trunk, then per branch its fork, its nodes, and a rejoin that has no trunk node.
export function listPairLadderInstants<I, P, U>(pair: WirePairOf<I, P, U>): I[] {
  const trunkInstants = listTrunkLadderInstants(pair);
  const instants: I[] = [...trunkInstants];
  for (const branch of pair.branches ?? []) {
    instants.push(branch.forkAt.instant);
    for (const node of branch.nodes) {
      instants.push(node.instant);
    }
    const rejoin = findRejoinWithOwnSlot(trunkInstants, branch);
    if (rejoin !== undefined) {
      instants.push(rejoin.instant);
    }
  }
  return instants;
}

// A disk orphan's own node leads, its snapshots follow — the server's third ladder group exactly.
export function listOrphanLadderInstants<I, P, U>(orphan: WireOrphanOf<I, P, U>): I[] {
  const instants: I[] = [orphan.instant];
  for (const snapshot of orphan.snapshots ?? []) {
    instants.push(snapshot.instant);
  }
  return instants;
}

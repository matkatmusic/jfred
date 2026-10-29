// Layer 1 view: node ladders and axis placement for one disk and repository pair.

import type { DiskFileState } from "./layer1_disk_walk.ts";
import type { NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import { listSnapshotInstants, createAxisWireSnapshots } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Instant } from "./layered_types.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";
import type { Layer1WirePair } from "./viewer_api_layer1.ts";

export interface PairHistory {
  file: DiskFileState;
  commits: { hash: string; instant: Instant }[];
}

// A birth later than the file's first commit is a checkout or copy time, so no node.
function readPairCreated(pair: PairHistory): { created?: Instant; createdNotTrusted?: CreatedNotTrustedReason } {
  const created = pair.file.createdAt;
  if (created === undefined) {
    return { createdNotTrusted: pair.file.createdNotTrusted };
  }
  const firstCommit = pair.commits[0]?.instant;
  const birthAfterFirstCommit = firstCommit !== undefined && created.getTime() > firstCommit.getTime();
  if (birthAfterFirstCommit) {
    return { createdNotTrusted: CreatedNotTrustedReason.birthAfterFirstCommit };
  }
  return { created };
}

// Reads PairHistory, not the wire pair; its ORDER mirrors listPairLadderInstants in webapp/layer1-wire-ladder.ts.
export function listPairNodeLadder(pair: PairHistory, snapshots?: SnapshotPlacement[]): NodeLadder {
  const { created } = readPairCreated(pair);
  const ladder: NodeLadder = [];
  if (created !== undefined) {
    ladder.push(created);
  }
  for (const commit of pair.commits) {
    ladder.push(commit.instant);
  }
  ladder.push(pair.file.mtime);
  // Appended, never interleaved, so every existing offset is untouched.
  ladder.push(...listSnapshotInstants(snapshots));
  return ladder;
}

// `nodeOffsetsPx` is positional and parallel to listPairNodeLadder's output, so equal instants can land differently.
export function buildPairOnAxis(pair: PairHistory, nodeOffsetsPx: number[], snapshots?: SnapshotPlacement[]): Layer1WirePair {
  const { created, createdNotTrusted } = readPairCreated(pair);
  const firstCommit = created === undefined ? 0 : 1;
  const onDiskIndex = firstCommit + pair.commits.length;
  const placedSnapshots = createAxisWireSnapshots(snapshots, nodeOffsetsPx.slice(onDiskIndex + 1));
  const commits: Layer1WirePair["commits"] = [];
  for (let node = 0; node < pair.commits.length; node += 1) {
    const commit = pair.commits[node]!;
    commits.push({ hash: commit.hash, instant: commit.instant, axisPx: nodeOffsetsPx[firstCommit + node]! });
  }
  return {
    path: pair.file.relativePath,
    ...(created === undefined ? { createdNotTrusted } : { created: { instant: created, axisPx: nodeOffsetsPx[0]! } }),
    commits,
    onDisk: { instant: pair.file.mtime, axisPx: nodeOffsetsPx[onDiskIndex]! },
    ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
  };
}

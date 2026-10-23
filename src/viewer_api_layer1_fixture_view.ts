// Builds the fixture Layer 1 wire view, mirroring buildLayer1View so offsets go through layOutNodeLadders.

import { Path } from "./structures/domain.ts";
import { layOutNodeLadders, type NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import { listSnapshotInstants, placeSnapshotsOnAxis } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Layer1WireOrphan, Layer1WirePair, Layer1WireView } from "./viewer_api_layer1.ts";
import { COMMITS, DISK, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { type FixturePair, buildFixturePair, sortByInstant } from "./viewer_api_layer1_fixture_pair.ts";
import { listFixtureSnapshotPlacements } from "./viewer_api_layer2_fixture_data.ts";
import { buildMockBranchesField, listMockBranchInstants } from "./viewer_api_layer5_mockup_branches.ts";

interface DiskOrphanRow { path: Path; instant: Date; snaps: SnapshotPlacement[]; }

function buildPlacedFixturePair(pair: FixturePair, nodeOffsetsPx: number[]): Layer1WirePair {
  const firstCommit = pair.created === undefined ? 0 : 1;
  const onDiskIndex = firstCommit + pair.commits.length;
  const placedSnapshots = placeSnapshotsOnAxis(pair.snaps, nodeOffsetsPx.slice(onDiskIndex + 1));
  const commits: Layer1WirePair["commits"] = [];
  for (let node = 0; node < pair.commits.length; node += 1) {
    const commit = pair.commits[node]!;
    commits.push({ hash: commit.hash, instant: commit.instant, axisPx: nodeOffsetsPx[firstCommit + node]! });
  }
  return {
    path: pair.path,
    ...(pair.created === undefined ? {} : { created: { instant: pair.created, axisPx: nodeOffsetsPx[0]! } }),
    commits,
    onDisk: { instant: pair.mtime, axisPx: nodeOffsetsPx[onDiskIndex]! },
    ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
    ...buildMockBranchesField(pair.path, nodeOffsetsPx.slice(pair.ladder.length)),
  };
}

function buildPlacedDiskOrphan(orphan: DiskOrphanRow, nodeOffsetsPx: number[]): Layer1WireOrphan {
  const placedSnapshots = placeSnapshotsOnAxis(orphan.snaps, nodeOffsetsPx.slice(1));
  return {
    path: orphan.path,
    instant: orphan.instant,
    axisPx: nodeOffsetsPx[0]!,
    ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
  };
}

function listRepoPaths(): string[] {
  const seen = new Set<string>();
  for (const commit of COMMITS) {
    for (const path of commit.files) {
      seen.add(path);
    }
  }
  return [...seen];
}

// A commit-only path sits at its last commit.
function findLastCommitInstant(path: string): Date {
  let lastAt = Number.NEGATIVE_INFINITY;
  for (const commit of COMMITS) {
    const isLaterCommit = commit.files.includes(path) && parseMs(commit.at) >= lastAt;
    if (isLaterCommit) {
      lastAt = parseMs(commit.at);
    }
  }
  return new Date(lastAt);
}

export function buildFixtureLayer1View(): Layer1WireView {
  const diskPaths = new Set<string>();
  for (const entry of DISK) {
    diskPaths.add(entry.path);
  }
  // pairedPaths have both a commit and a disk file; gitOrphans are commit-only paths.
  const pairedPaths: string[] = [];
  const gitOrphans: { path: Path; instant: Date }[] = [];
  for (const path of listRepoPaths()) {
    const hasDiskFile = diskPaths.has(path);
    if (hasDiskFile) {
      pairedPaths.push(path);
    }
    else {
      gitOrphans.push({ path: new Path(path), instant: findLastCommitInstant(path) });
    }
  }
  const pairs: FixturePair[] = [];
  for (const path of pairedPaths) {
    pairs.push(buildFixturePair(path));
  }
  const diskOrphans: DiskOrphanRow[] = [];
  for (const entry of DISK) {
    const isPaired = pairedPaths.includes(entry.path);
    if (!isPaired) {
      diskOrphans.push({
        path: new Path(entry.path), instant: new Date(parseMs(entry.at)), snaps: listFixtureSnapshotPlacements(entry.path),
      });
    }
  }
  const ladders: NodeLadder[] = [];
  for (const pair of pairs) {
    ladders.push([...pair.ladder, ...listMockBranchInstants(pair.path)]);
  }
  for (const orphan of gitOrphans) {
    ladders.push([orphan.instant]);
  }
  for (const orphan of diskOrphans) {
    ladders.push([orphan.instant, ...listSnapshotInstants(orphan.snaps)]);
  }
  const layout = layOutNodeLadders(ladders);
  const offsets = new Map<number, number>();
  const ruler: Layer1WireView["ruler"] = [];
  for (const tick of layout.ticks) {
    offsets.set(tick.instant.getTime(), tick.offsetPx);
    ruler.push({ instant: tick.instant, axisPx: tick.offsetPx, eventCount: tick.eventCount });
  }
  const placedPairs: Layer1WirePair[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    placedPairs.push(buildPlacedFixturePair(pairs[index]!, layout.ladderOffsetsPx[index]!));
  }
  const placedGitOrphans: Layer1WireView["gitOrphans"] = [];
  for (const orphan of gitOrphans) {
    placedGitOrphans.push({ path: orphan.path, instant: orphan.instant, axisPx: offsets.get(orphan.instant.getTime())! });
  }
  const diskOrphanBase = pairs.length + gitOrphans.length;
  const placedDiskOrphans: Layer1WireOrphan[] = [];
  for (let index = 0; index < diskOrphans.length; index += 1) {
    placedDiskOrphans.push(buildPlacedDiskOrphan(diskOrphans[index]!, layout.ladderOffsetsPx[diskOrphanBase + index]!));
  }
  return {
    pairs: placedPairs,
    gitOrphans: sortByInstant(placedGitOrphans),
    diskOrphans: sortByInstant(placedDiskOrphans),
    ruler,
  };
}

// Builds the fixture Layer 1 wire view, mirroring buildLayer1View so offsets go through computeNodeLadderLayout.

import { Path } from "./structures/domain.ts";
import { computeNodeLadderLayout, type NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import { listSnapshotInstants, createAxisWireSnapshots } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Layer1WireOrphan, Layer1WirePair, Layer1WireView } from "./viewer_api_layer1.ts";
import { COMMITS, DISK, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { type FixturePair, buildFixturePair, sortByInstant } from "./viewer_api_layer1_fixture_pair.ts";
import { listFixtureSnapshotPlacements } from "./viewer_api_layer2_fixture_data.ts";
import { buildFixtureAnnotations, buildToolNodes } from "./viewer_api_layer7_fixture_data.ts";
import { buildFixtureJfredCommits } from "./viewer_api_layer9_fixture_data.ts";
// import { buildMockBranchesField, listMockBranchInstants } from "./viewer_api_layer5_mockup_branches.ts";

interface DiskOrphanRow { path: Path; instant: Date; snaps: SnapshotPlacement[]; }

function buildToolNodesField(pair: FixturePair, firstOffset: number, nodeOffsetsPx: number[]): Pick<Layer1WirePair, "toolNodes"> {
  const toolNodes = buildToolNodes(pair.path.toString(), nodeOffsetsPx.slice(firstOffset));
  return toolNodes.length === 0 ? {} : { toolNodes };
}

function buildPlacedCommits(pair: FixturePair, firstCommit: number, nodeOffsetsPx: number[]): Layer1WirePair["commits"] {
  const commits: Layer1WirePair["commits"] = [];
  for (let node = 0; node < pair.commits.length; node += 1) {
    const commit = pair.commits[node]!;
    commits.push({ hash: commit.hash, instant: commit.instant, axisPx: nodeOffsetsPx[firstCommit + node]! });
  }
  return commits;
}

function buildPlacedFixturePair(pair: FixturePair, nodeOffsetsPx: number[]): Layer1WirePair {
  const firstCommit = pair.created === undefined ? 0 : 1;
  const onDiskIndex = firstCommit + pair.commits.length;
  const placedSnapshots = createAxisWireSnapshots(pair.snaps, nodeOffsetsPx.slice(onDiskIndex + 1));
  return {
    path: pair.path,
    ...(pair.created === undefined ? {} : { created: { instant: pair.created, axisPx: nodeOffsetsPx[0]! } }),
    commits: buildPlacedCommits(pair, firstCommit, nodeOffsetsPx),
    onDisk: { instant: pair.mtime, axisPx: nodeOffsetsPx[onDiskIndex]! },
    ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
    ...buildToolNodesField(pair, onDiskIndex + 1 + pair.snaps.length, nodeOffsetsPx),
    // ...buildMockBranchesField(pair.path, nodeOffsetsPx.slice(pair.ladder.length)),
  };
}

function buildPlacedDiskOrphan(orphan: DiskOrphanRow, nodeOffsetsPx: number[]): Layer1WireOrphan {
  const placedSnapshots = createAxisWireSnapshots(orphan.snaps, nodeOffsetsPx.slice(1));
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

interface GitOrphanRow { path: Path; instant: Date; }

function listDiskPaths(): Set<string> {
  const diskPaths = new Set<string>();
  for (const entry of DISK) {
    diskPaths.add(entry.path);
  }
  return diskPaths;
}

// pairedPaths have both a commit and a disk file; gitOrphans are commit-only paths.
function splitRepoPaths(diskPaths: Set<string>): { pairedPaths: string[]; gitOrphans: GitOrphanRow[] } {
  const pairedPaths: string[] = [];
  const gitOrphans: GitOrphanRow[] = [];
  for (const path of listRepoPaths()) {
    const hasDiskFile = diskPaths.has(path);
    if (hasDiskFile) {
      pairedPaths.push(path);
    }
    else {
      gitOrphans.push({ path: new Path(path), instant: findLastCommitInstant(path) });
    }
  }
  return { pairedPaths, gitOrphans };
}

function listDiskOrphanRows(pairedPaths: string[]): DiskOrphanRow[] {
  const diskOrphans: DiskOrphanRow[] = [];
  for (const entry of DISK) {
    const isPaired = pairedPaths.includes(entry.path);
    if (!isPaired) {
      diskOrphans.push({
        path: new Path(entry.path), instant: new Date(parseMs(entry.at)), snaps: listFixtureSnapshotPlacements(entry.path),
      });
    }
  }
  return diskOrphans;
}

function listFixtureLadders(pairs: FixturePair[], gitOrphans: GitOrphanRow[], diskOrphans: DiskOrphanRow[]): NodeLadder[] {
  const ladders: NodeLadder[] = [];
  for (const pair of pairs) {
    // ladders.push([...pair.ladder, ...listMockBranchInstants(pair.path)]);
    ladders.push([...pair.ladder]);
  }
  for (const orphan of gitOrphans) {
    ladders.push([orphan.instant]);
  }
  for (const orphan of diskOrphans) {
    ladders.push([orphan.instant, ...listSnapshotInstants(orphan.snaps)]);
  }
  return ladders;
}

function buildPlacedGitOrphans(gitOrphans: GitOrphanRow[], ticks: ReturnType<typeof computeNodeLadderLayout>["ticks"]): Layer1WireView["gitOrphans"] {
  const offsets = new Map<number, number>();
  for (const tick of ticks) {
    offsets.set(tick.instant.getTime(), tick.offsetPx);
  }
  const placed: Layer1WireView["gitOrphans"] = [];
  for (const orphan of gitOrphans) {
    placed.push({ path: orphan.path, instant: orphan.instant, axisPx: offsets.get(orphan.instant.getTime())! });
  }
  return placed;
}

function buildFixtureRuler(ticks: ReturnType<typeof computeNodeLadderLayout>["ticks"]): Layer1WireView["ruler"] {
  const ruler: Layer1WireView["ruler"] = [];
  for (const tick of ticks) {
    ruler.push({ instant: tick.instant, axisPx: tick.offsetPx, eventCount: tick.eventCount });
  }
  return ruler;
}

function buildPlacedDiskOrphans(diskOrphans: DiskOrphanRow[], firstLadder: number, ladderOffsetsPx: number[][]): Layer1WireOrphan[] {
  const placed: Layer1WireOrphan[] = [];
  for (let index = 0; index < diskOrphans.length; index += 1) {
    placed.push(buildPlacedDiskOrphan(diskOrphans[index]!, ladderOffsetsPx[firstLadder + index]!));
  }
  return placed;
}

function buildPlacedPairs(pairs: FixturePair[], ladderOffsetsPx: number[][]): Layer1WirePair[] {
  const placed: Layer1WirePair[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    placed.push(buildPlacedFixturePair(pairs[index]!, ladderOffsetsPx[index]!));
  }
  return placed;
}

function buildFixturePairs(pairedPaths: string[]): FixturePair[] {
  const pairs: FixturePair[] = [];
  for (const path of pairedPaths) {
    pairs.push(buildFixturePair(path));
  }
  return pairs;
}

export function buildFixtureLayer1View(): Layer1WireView {
  const { pairedPaths, gitOrphans } = splitRepoPaths(listDiskPaths());
  const pairs = buildFixturePairs(pairedPaths);
  const diskOrphans = listDiskOrphanRows(pairedPaths);
  const layout = computeNodeLadderLayout(listFixtureLadders(pairs, gitOrphans, diskOrphans));
  const ruler = buildFixtureRuler(layout.ticks);
  return {
    pairs: buildPlacedPairs(pairs, layout.ladderOffsetsPx),
    gitOrphans: sortByInstant(buildPlacedGitOrphans(gitOrphans, layout.ticks)),
    diskOrphans: sortByInstant(buildPlacedDiskOrphans(diskOrphans, pairs.length + gitOrphans.length, layout.ladderOffsetsPx)),
    ruler,
    annotations: buildFixtureAnnotations(ruler),
    jfredCommits: buildFixtureJfredCommits(),
  };
}

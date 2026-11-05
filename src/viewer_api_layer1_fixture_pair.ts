// Fixture file pairs (commit instants plus disk plus snapshots), split from viewer_api_layer1_fixture_view.ts.

import { Path } from "./structures/domain.ts";
import type { NodeLadder } from "../webapp/layer1-components/ruler/layer1-ruler-axis.ts";
import { listSnapshotInstants } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import { COMMITS, DISK, parseMs } from "./viewer_api_layer1_fixture_data.ts";
import type { FixtureDisk } from "./viewer_api_layer1_fixture_data.ts";
import { listFixtureSnapshotPlacements } from "./viewer_api_layer2_fixture_data.ts";
import { listToolNodeInstants } from "./viewer_api_layer7_fixture_data.ts";

export interface CommitInstant { hash: string; instant: Date; }

export interface FixturePair {
  path: Path;
  commits: CommitInstant[];
  created: Date | undefined;
  mtime: Date;
  snaps: SnapshotPlacement[];
  ladder: NodeLadder;
  toolNodes: Date[];
}

function compareByInstant(left: { instant: Date }, right: { instant: Date }): number {
  return left.instant.getTime() - right.instant.getTime();
}

export function sortByInstant<T extends { instant: Date }>(rows: T[]): T[] {
  return [...rows].sort(compareByInstant);
}

function listCommitInstants(path: string): CommitInstant[] {
  const rows: CommitInstant[] = [];
  for (const commit of COMMITS) {
    const touchesPath = commit.files.includes(path);
    if (touchesPath) {
      rows.push({ hash: commit.hash, instant: new Date(parseMs(commit.at)) });
    }
  }
  return sortByInstant(rows);
}

function findDiskEntry(path: string): FixtureDisk {
  for (const entry of DISK) {
    if (entry.path === path) {
      return entry;
    }
  }
  throw new Error(`no DISK entry for ${path}`);
}

function listFixtureLadder(pair: Omit<FixturePair, "path" | "ladder">): NodeLadder {
  const ladder: NodeLadder = [];
  if (pair.created !== undefined) {
    ladder.push(pair.created);
  }
  for (const commit of pair.commits) {
    ladder.push(commit.instant);
  }
  ladder.push(pair.mtime);
  ladder.push(...listSnapshotInstants(pair.snaps));
  ladder.push(...pair.toolNodes);
  return ladder;
}

// created is present only when born < mtime (the plan's rule); README.md's born === mtime, so it has none.
export function buildFixturePair(path: string): FixturePair {
  const disk = findDiskEntry(path);
  const born = new Date(parseMs(disk.born));
  const mtime = new Date(parseMs(disk.at));
  const commits = listCommitInstants(path);
  const created = parseMs(disk.born) < parseMs(disk.at) ? born : undefined;
  const snaps = listFixtureSnapshotPlacements(path);
  const toolNodes = listToolNodeInstants(path);
  const ladder = listFixtureLadder({ commits, created, mtime, snaps, toolNodes });
  return { path: new Path(path), commits, created, mtime, snaps, ladder, toolNodes };
}

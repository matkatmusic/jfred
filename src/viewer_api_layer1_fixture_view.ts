// Task 330: buildFixtureLayer1View — mirrors buildLayer1View so offsets go THROUGH layOutNodeLadders.
//
// Split from viewer_api_layer1_fixture.ts at the 250-line cap; the route file owns the eight handlers.

import { Path } from "./structures/domain.ts";
import { layOutNodeLadders, type NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import { listSnapshotInstants, placeSnapshotsOnAxis } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Layer1WireOrphan, Layer1WirePair, Layer1WireView } from "./viewer_api_layer1.ts";
import { COMMITS, DISK, fixtureSnapshotPlacements, ms } from "./viewer_api_layer1_fixture_data.ts";

interface FixturePair {
    path: Path;
    commits: { hash: string; instant: Date }[];
    created: Date | undefined;
    mtime: Date;
    snaps: SnapshotPlacement[];
    ladder: NodeLadder;
}

function commitInstantsFor(path: string): { hash: string; instant: Date }[] {
    return COMMITS.filter((commit) => commit.files.includes(path))
        .map((commit) => ({ hash: commit.hash, instant: new Date(ms(commit.at)) }))
        .sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

function orderByInstant<T extends { instant: Date }>(rows: T[]): T[] {
    return [...rows].sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

// created is present only when born < mtime (the plan's rule); README.md's born === mtime, so it has none.
function buildFixturePair(path: string): FixturePair {
    const disk = DISK.find((entry) => entry.path === path)!;
    const born = new Date(ms(disk.born));
    const mtime = new Date(ms(disk.at));
    const commits = commitInstantsFor(path);
    const created = ms(disk.born) < ms(disk.at) ? born : undefined;
    const snaps = fixtureSnapshotPlacements(path);
    const ladder: NodeLadder = [
        ...(created === undefined ? [] : [created]),
        ...commits.map((commit) => commit.instant),
        mtime,
        ...listSnapshotInstants(snaps),
    ];
    return { path: new Path(path), commits, created, mtime, snaps, ladder };
}

function placeFixturePair(pair: FixturePair, nodeOffsetsPx: number[]): Layer1WirePair {
    const firstCommit = pair.created === undefined ? 0 : 1;
    const onDiskIndex = firstCommit + pair.commits.length;
    const placedSnapshots = placeSnapshotsOnAxis(pair.snaps, nodeOffsetsPx.slice(onDiskIndex + 1));
    return {
        path: pair.path,
        ...(pair.created === undefined ? {} : { created: { instant: pair.created, axisPx: nodeOffsetsPx[0]! } }),
        commits: pair.commits.map((commit, node) => ({
            hash: commit.hash, instant: commit.instant, axisPx: nodeOffsetsPx[firstCommit + node]!,
        })),
        onDisk: { instant: pair.mtime, axisPx: nodeOffsetsPx[onDiskIndex]! },
        ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
    };
}

function placeFixtureDiskOrphan(
    orphan: { path: Path; instant: Date; snaps: SnapshotPlacement[] }, nodeOffsetsPx: number[],
): Layer1WireOrphan {
    const placedSnapshots = placeSnapshotsOnAxis(orphan.snaps, nodeOffsetsPx.slice(1));
    return {
        path: orphan.path,
        instant: orphan.instant,
        axisPx: nodeOffsetsPx[0]!,
        ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
    };
}

export function buildFixtureLayer1View(): Layer1WireView {
    const repoPaths = [...new Set(COMMITS.flatMap((commit) => commit.files))];
    const diskPaths = DISK.map((entry) => entry.path);
    const pairedPaths = repoPaths.filter((path) => diskPaths.includes(path));
    const pairs = pairedPaths.map(buildFixturePair);
    // gitOrphans = commit-only paths (docs/old-api.md, scripts/deploy.sh), placed at their last commit.
    const gitOrphans = repoPaths.filter((path) => !pairedPaths.includes(path)).map((path) => {
        const last = COMMITS.filter((commit) => commit.files.includes(path))
            .sort((left, right) => ms(left.at) - ms(right.at)).at(-1)!;
        return { path: new Path(path), instant: new Date(ms(last.at)) };
    });
    const diskOrphans = DISK.filter((entry) => !pairedPaths.includes(entry.path)).map((entry) => ({
        path: new Path(entry.path), instant: new Date(ms(entry.at)), snaps: fixtureSnapshotPlacements(entry.path),
    }));
    const layout = layOutNodeLadders([
        ...pairs.map((pair) => pair.ladder),
        ...gitOrphans.map((orphan) => [orphan.instant]),
        ...diskOrphans.map((orphan) => [orphan.instant, ...listSnapshotInstants(orphan.snaps)]),
    ]);
    const offsets = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    const diskOrphanBase = pairs.length + gitOrphans.length;
    return {
        pairs: pairs.map((pair, index) => placeFixturePair(pair, layout.ladderOffsetsPx[index]!)),
        gitOrphans: orderByInstant(gitOrphans.map((orphan) => ({
            path: orphan.path, instant: orphan.instant, axisPx: offsets.get(orphan.instant.getTime())!,
        }))),
        diskOrphans: orderByInstant(diskOrphans.map((orphan, index) =>
            placeFixtureDiskOrphan(orphan, layout.ladderOffsetsPx[diskOrphanBase + index]!))),
        ruler: layout.ticks.map((tick) => ({ instant: tick.instant, axisPx: tick.offsetPx, eventCount: tick.eventCount })),
    };
}


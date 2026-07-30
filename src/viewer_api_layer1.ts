// Layer 1 View (spec S18): on-disk state against the repository. Reads no JSONL, meaningful to the task-238 acceptance test.

import { listPairCommitHistory } from "./layer1_commit_history.ts";
import { walkCurrentFileState, type DiskFileState } from "./layer1_disk_walk.ts";
import { pairDiskFilesAgainstRepoPaths } from "./layer1_pairing.ts";
import { readRepoTreeAtRef } from "./layer1_repo_tree.ts";
import { layOutNodeLadders, type NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import { collectViewSnapshotsByRelativePath, listSnapshotInstants, placeSnapshotsOnAxis } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Instant } from "./layered_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import { CommitTimeSource, type WireInstantOf, type WireCommitOf, type WireRulerTickOf, type WirePairOf, type WireOrphanOf, type WireLayer1ViewOf } from "../webapp/layer1-wire.ts";

// Named so tests assert the same strings the route emits rather than re-typing them.
export const LAYER1_PROGRESS_LABEL_WALKING_FOLDER = "walking project folder";
export const LAYER1_PROGRESS_LABEL_READING_TREE = "reading repository tree";
export const LAYER1_PROGRESS_LABEL_READING_HISTORY = "reading file history";
export const LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY = "placing repository-only files";
export const LAYER1_PROGRESS_LABEL_RESOLVING_RULER = "resolving the ruler";

// Server instantiation of the wire vocabulary (webapp/layer1-wire.ts): Date instants, domain Path/Uuid.
export type Layer1WireInstant = WireInstantOf<Instant>;
export type Layer1WireCommit = WireCommitOf<Instant>;
export type Layer1WireRulerTick = WireRulerTickOf<Instant>;
export type Layer1WirePair = WirePairOf<Instant, Path, Uuid>;
export type Layer1WireOrphan = WireOrphanOf<Instant, Path, Uuid>;
export type Layer1WireView = WireLayer1ViewOf<Instant, Path, Uuid>;

interface GitOrphanPlacement {
    path: Path;
    instant: Instant;
}

interface PairHistory {
    file: DiskFileState;
    commits: { hash: string; instant: Instant }[];
}

// Reuses /api/document's ProgressEvent shape rather than inventing a second progress vocabulary.
function reportStage(reportProgress: ProgressSink, label: string, current?: number, total?: number): void {
    reportProgress({ kind: DocumentResponseKind.progress, label, current, total });
}

// A birth later than the file's first commit is a checkout or copy time, so no node.
function readPairCreatedInstant(pair: PairHistory): Instant | undefined {
    const created = pair.file.createdAt;
    const firstCommit = pair.commits[0]?.instant;
    if (created === undefined || (firstCommit !== undefined && created.getTime() > firstCommit.getTime())) {
        return undefined;
    }
    return created;
}

// Reads PairHistory, not the wire pair; its ORDER mirrors listPairLadderInstants in webapp/layer1-wire.ts.
function listPairNodeLadder(pair: PairHistory, snapshots?: SnapshotPlacement[]): NodeLadder {
    const created = readPairCreatedInstant(pair);
    return [
        ...(created === undefined ? [] : [created]),
        ...pair.commits.map((commit) => commit.instant),
        pair.file.mtime,
        // Appended, never interleaved: layOutNodeLadders reads a ladder as a multiset, so every existing offset is untouched.
        ...listSnapshotInstants(snapshots),
    ];
}

// `nodeOffsetsPx` is parallel to listPairNodeLadder's output, positional not a lookup, letting two nodes sharing an instant land differently.
function placePairNodesOnAxis(pair: PairHistory, nodeOffsetsPx: number[], snapshots?: SnapshotPlacement[]): Layer1WirePair {
    const created = readPairCreatedInstant(pair);
    const firstCommit = created === undefined ? 0 : 1;
    const onDiskIndex = firstCommit + pair.commits.length;
    const placedSnapshots = placeSnapshotsOnAxis(snapshots, nodeOffsetsPx.slice(onDiskIndex + 1));
    return {
        path: pair.file.relativePath,
        ...(created === undefined ? {} : { created: { instant: created, axisPx: nodeOffsetsPx[0]! } }),
        commits: pair.commits.map((commit, node) => ({
            hash: commit.hash,
            instant: commit.instant,
            axisPx: nodeOffsetsPx[firstCommit + node]!,
        })),
        onDisk: { instant: pair.file.mtime, axisPx: nodeOffsetsPx[onDiskIndex]! },
        ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
    };
}

// Every instant here was resolve input; a miss is a bug — fail loudly, not silent zero.
function placeInstantOnAxis(offsets: Map<number, number>, instant: Instant): Layer1WireInstant {
    const axisPx = offsets.get(instant.getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${instant.toISOString()} is missing from the resolved ruler`);
    }
    return { instant, axisPx };
}

// A repo path with no on-disk counterpart has no mtime; its last touching commit is when it last existed.
function listGitOrphanPlacements(repoDir: Path, gitOrphans: Path[], ref: string, reportProgress: ProgressSink, timeSource: CommitTimeSource): GitOrphanPlacement[] {
    const placements: GitOrphanPlacement[] = [];
    for (let index = 0; index < gitOrphans.length; index += 1) {
        const orphanPath = gitOrphans[index]!;
        reportStage(reportProgress, LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY, index + 1, gitOrphans.length);
        const lastTouch = listPairCommitHistory(repoDir, orphanPath, ref, timeSource).at(-1);
        // ponytail: a shallow clone's truncated history can leave no commit; such a row is dropped, not faked. Revisit if needed.
        if (lastTouch === undefined) {
            continue;
        }
        placements.push({ path: orphanPath, instant: lastTouch.instant });
    }
    return placements;
}

// Ascending, so a bucket's placement is simply its first row's axisPx and the page needs no Math.min.
function orderRowsByInstant(rows: Layer1WireOrphan[]): Layer1WireOrphan[] {
    return [...rows].sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

// `reportProgress` is explicit rather than reconstruction_progress.ts's process-wide sink, scoped to document builds, which would mix routes together.
export function buildLayer1View(
    projectFolder: Path,
    repoDir: Path,
    ref: string,
    reportProgress: ProgressSink = () => {},
    timeSource: CommitTimeSource = CommitTimeSource.committer,
    sessionFiles: readonly Path[] = [],
): Layer1WireView {
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_WALKING_FOLDER);
    const diskFiles = walkCurrentFileState(projectFolder);
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_TREE);
    // Runs before any history read so a bad ref throws once; only `trackedFiles` is paired.
    const repoTree = readRepoTreeAtRef(repoDir, ref);
    const pairing = pairDiskFilesAgainstRepoPaths(diskFiles, repoTree.trackedFiles);
    // One `git log` per path is where this route's ~10 s goes. ponytail: unbatched, batch if rate matters.
    const pairHistories: PairHistory[] = [];
    for (let index = 0; index < pairing.pairs.length; index += 1) {
        const file = pairing.pairs[index]!;
        reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_HISTORY, index + 1, pairing.pairs.length);
        pairHistories.push({ file, commits: listPairCommitHistory(repoDir, file.relativePath, ref, timeSource) });
    }
    const gitOrphanPlacements = listGitOrphanPlacements(repoDir, pairing.gitOrphans, ref, reportProgress, timeSource);
    // Task 312: an empty session list loops zero times, so a Layer 1 build reports no extra stage.
    const snapshotsByPath = collectViewSnapshotsByRelativePath(projectFolder, sessionFiles, reportProgress);
    const snapshotsFor = (path: Path): SnapshotPlacement[] | undefined => snapshotsByPath.get(path.toString());
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER);
    // Pair ladders come first, so `ladderOffsetsPx[index]` is that pair's rows; a git orphan is one node.
    const layout = layOutNodeLadders([
        ...pairHistories.map((pair) => listPairNodeLadder(pair, snapshotsFor(pair.file.relativePath))),
        ...gitOrphanPlacements.map((placement) => [placement.instant]),
        ...pairing.diskOrphans.map((file) => [file.mtime, ...listSnapshotInstants(snapshotsFor(file.relativePath))]),
        // Task 303: per-ladder count so the ~900-ladder resolve never reads as a hang.
    ], new Map(), (done, total) => reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER, done, total));
    // Ticks, not node rows: a bucket is placed at its instant's own position on the shared ruler.
    const offsets = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    // A disk orphan's own node is ladder slot 0, which IS the tick offset; its snapshots stack below it.
    const diskOrphanLadderBase = pairHistories.length + gitOrphanPlacements.length;
    return {
        pairs: pairHistories.map((pair, index) =>
            placePairNodesOnAxis(pair, layout.ladderOffsetsPx[index]!, snapshotsFor(pair.file.relativePath))),
        gitOrphans: orderRowsByInstant(gitOrphanPlacements.map((placement) => ({
            path: placement.path,
            ...placeInstantOnAxis(offsets, placement.instant),
        }))),
        diskOrphans: orderRowsByInstant(pairing.diskOrphans.map((file, index) => {
            const nodeOffsetsPx = layout.ladderOffsetsPx[diskOrphanLadderBase + index]!;
            const placedSnapshots = placeSnapshotsOnAxis(snapshotsFor(file.relativePath), nodeOffsetsPx.slice(1));
            return {
                path: file.relativePath,
                instant: file.mtime,
                axisPx: nodeOffsetsPx[0]!,
                ...(placedSnapshots.length === 0 ? {} : { snapshots: placedSnapshots }),
            };
        })),
        ruler: layout.ticks.map((tick) => ({
            instant: tick.instant,
            axisPx: tick.offsetPx,
            eventCount: tick.eventCount,
        })),
    };
}

// Layer 1 View (spec S18): on-disk state against the repository. Reads NO JSONL, which is what
// makes the task-238 acceptance test meaningful.

import { listPairCommitHistory } from "./layer1_commit_history.ts";
import { walkCurrentFileState, type DiskFileState } from "./layer1_disk_walk.ts";
import { pairDiskFilesAgainstRepoPaths } from "./layer1_pairing.ts";
import { readRepoTreeAtRef } from "./layer1_repo_tree.ts";
import { layOutNodeLadders, type NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import type { Instant } from "./layered_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import { CommitTimeSource } from "./structures/vocabulary_view.ts";

// Named so tests assert the same strings the route emits rather than re-typing them.
export const LAYER1_PROGRESS_LABEL_WALKING_FOLDER = "walking project folder";
export const LAYER1_PROGRESS_LABEL_READING_TREE = "reading repository tree";
export const LAYER1_PROGRESS_LABEL_READING_HISTORY = "reading file history";
export const LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY = "placing repository-only files";
export const LAYER1_PROGRESS_LABEL_RESOLVING_RULER = "resolving the ruler";

// The S18 ruler ACCUMULATES, so an offset cannot be derived from its own instant — the page must
// be handed the finished number.
export interface Layer1WireInstant {
    instant: Instant;
    axisPx: number;
}

export interface Layer1WireCommit extends Layer1WireInstant {
    hash: string;
}

export interface Layer1WireRulerTick extends Layer1WireInstant {
    // Nodes drawn at this instant across every bubble; measured by layOutNodeLadders so a
    // client-side folder-filter re-layout produces the same number.
    eventCount: number;
}

// Commits are oldest first; `onDisk` is S18's final node.
export interface Layer1WirePair {
    path: Path;
    commits: Layer1WireCommit[];
    onDisk: Layer1WireInstant;
}

export interface Layer1WireOrphan extends Layer1WireInstant {
    path: Path;
}

// The two orphan sets are mirror images, so a swap is invisible to the task-238 acceptance test
// and must never happen here (S18 "Output contract").
export interface Layer1WireView {
    pairs: Layer1WirePair[];
    gitOrphans: Layer1WireOrphan[];
    diskOrphans: Layer1WireOrphan[];
    ruler: Layer1WireRulerTick[];
}

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

// Order is load-bearing: it decides which tied node takes the upper row, and it makes the returned
// offsets readable positionally below.
function listPairNodeLadder(pair: PairHistory): NodeLadder {
    return [...pair.commits.map((commit) => commit.instant), pair.file.mtime];
}

// `nodeOffsetsPx` is parallel to listPairNodeLadder's output — positional, not a lookup, which is
// what lets two nodes sharing an instant come back on different rows.
function placePairNodesOnAxis(pair: PairHistory, nodeOffsetsPx: number[]): Layer1WirePair {
    return {
        path: pair.file.relativePath,
        commits: pair.commits.map((commit, node) => ({
            hash: commit.hash,
            instant: commit.instant,
            axisPx: nodeOffsetsPx[node]!,
        })),
        onDisk: { instant: pair.file.mtime, axisPx: nodeOffsetsPx.at(-1)! },
    };
}

// Every instant here was part of the resolve input, so a miss is a bug in this file — fail loudly
// instead of drawing a node at a silent zero.
function placeInstantOnAxis(offsets: Map<number, number>, instant: Instant): Layer1WireInstant {
    const axisPx = offsets.get(instant.getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${instant.toISOString()} is missing from the resolved ruler`);
    }
    return { instant, axisPx };
}

// A repo path with no on-disk counterpart has no mtime, so its LAST touching commit is the moment
// it last existed in the repo.
function listGitOrphanPlacements(repoDir: Path, gitOrphans: Path[], ref: string, reportProgress: ProgressSink, timeSource: CommitTimeSource): GitOrphanPlacement[] {
    const placements: GitOrphanPlacement[] = [];
    for (let index = 0; index < gitOrphans.length; index += 1) {
        const orphanPath = gitOrphans[index]!;
        reportStage(reportProgress, LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY, index + 1, gitOrphans.length);
        const lastTouch = listPairCommitHistory(repoDir, orphanPath, ref, timeSource).at(-1);
        // ponytail: a path git lists at `ref` always has a commit reachable from that ref, so this
        // only holds for a shallow clone whose history was truncated; such a row is dropped rather
        // than invented at a fake instant. Revisit if shallow clones become a real input.
        if (lastTouch === undefined) {
            continue;
        }
        placements.push({ path: orphanPath, instant: lastTouch.instant });
    }
    return placements;
}

// Ascending, so a bucket's placement is simply its first row's axisPx and the page needs no
// Math.min.
function orderRowsByInstant(rows: Layer1WireOrphan[]): Layer1WireOrphan[] {
    return [...rows].sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

// `reportProgress` is explicit rather than reconstruction_progress.ts's process-wide sink, which
// is scoped to document builds and would mix this route's lines into one.
export function buildLayer1View(
    projectFolder: Path,
    repoDir: Path,
    ref: string,
    reportProgress: ProgressSink = () => {},
    timeSource: CommitTimeSource = CommitTimeSource.committer,
): Layer1WireView {
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_WALKING_FOLDER);
    const diskFiles = walkCurrentFileState(projectFolder);
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_TREE);
    // Runs BEFORE any history read so a bad ref throws once rather than degrading into empty
    // ladders. Only `trackedFiles` is paired: a submodule gitlink would invent a phantom row.
    const repoTree = readRepoTreeAtRef(repoDir, ref);
    const pairing = pairDiskFilesAgainstRepoPaths(diskFiles, repoTree.trackedFiles);
    // One `git log` per tracked path is where this route's ~10 s goes, so each iteration announces
    // its position. ponytail: unbatched — batch into groups here if the line rate starts to matter.
    const pairHistories: PairHistory[] = [];
    for (let index = 0; index < pairing.pairs.length; index += 1) {
        const file = pairing.pairs[index]!;
        reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_HISTORY, index + 1, pairing.pairs.length);
        pairHistories.push({ file, commits: listPairCommitHistory(repoDir, file.relativePath, ref, timeSource) });
    }
    const gitOrphanPlacements = listGitOrphanPlacements(repoDir, pairing.gitOrphans, ref, reportProgress, timeSource);
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER);
    // Pair ladders come FIRST and in `pairHistories` order, which is what makes
    // `ladderOffsetsPx[index]` that pair's own rows. An orphan is a ONE-node ladder: it bounds the
    // ruler without being charged a stacked row.
    const layout = layOutNodeLadders([
        ...pairHistories.map(listPairNodeLadder),
        ...gitOrphanPlacements.map((placement) => [placement.instant]),
        ...pairing.diskOrphans.map((file) => [file.mtime]),
    ]);
    // Ticks, not node rows: a bucket is placed at its instant's own position on the shared ruler.
    const offsets = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        pairs: pairHistories.map((pair, index) => placePairNodesOnAxis(pair, layout.ladderOffsetsPx[index]!)),
        gitOrphans: orderRowsByInstant(gitOrphanPlacements.map((placement) => ({
            path: placement.path,
            ...placeInstantOnAxis(offsets, placement.instant),
        }))),
        diskOrphans: orderRowsByInstant(pairing.diskOrphans.map((file) => ({
            path: file.relativePath,
            ...placeInstantOnAxis(offsets, file.mtime),
        }))),
        ruler: layout.ticks.map((tick) => ({
            instant: tick.instant,
            axisPx: tick.offsetPx,
            eventCount: tick.eventCount,
        })),
    };
}

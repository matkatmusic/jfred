// The Layer 1 View server surface (task 235, spec S18): what is on disk right now against what the
// repository says. A NEW path beside /api/layered-graph, not a change to it — it reads NO JSONL at
// all, which is what makes the task-238 acceptance test meaningful (it cannot accidentally pass on
// JSONL data). HTTP wiring stays in viewer_server.ts; this file parses the query, composes the five
// layer1_* modules, and serializes (precedent: viewer_api_layered.ts).

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

// The stages this route announces. Named here so the tests assert the same strings the route
// emits rather than re-typing them (precedent: PROGRESS_LABEL_PARSING_RECORDS).
export const LAYER1_PROGRESS_LABEL_WALKING_FOLDER = "walking project folder";
export const LAYER1_PROGRESS_LABEL_READING_TREE = "reading repository tree";
export const LAYER1_PROGRESS_LABEL_READING_HISTORY = "reading file history";
export const LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY = "placing repository-only files";
export const LAYER1_PROGRESS_LABEL_RESOLVING_RULER = "resolving the ruler";

// One placed moment on the wire: the instant, plus the finished pixel offset the page emits as
// --axis-px. The S18 ruler ACCUMULATES, so an offset cannot be derived from its own instant — the
// page must be handed the number (the same contract as task 239's axisOffsetsPx). Since task 251 a
// NODE's axisPx also carries its row within its instant, so two nodes of one pair that share a
// moment arrive one row apart and the page still does no arithmetic. `ruler` keeps the instant's
// own tick — its first row — which is the anchor a same-instant indicator reads against (task 259).
export interface Layer1WireInstant {
    instant: Instant;
    axisPx: number;
}

// One commit node of a pair's ladder.
export interface Layer1WireCommit extends Layer1WireInstant {
    hash: string;
}

// One RULER entry. Its own type rather than a widened Layer1WireInstant: every commit, orphan and
// on-disk node is one of those too, and none of them carries a count.
export interface Layer1WireRulerTick extends Layer1WireInstant {
    // Task 275: how many nodes the view draws at this instant, across every bubble — "how many
    // events occurred at that timestamp", which the gutter prints after the label. Measured by
    // layOutNodeLadders so the client-side re-layout a folder filter runs produces the same number.
    eventCount: number;
}

// One pair: its path relative to BOTH roots, the commits that touched it (oldest first), and its
// current on-disk state — S18's final node.
export interface Layer1WirePair {
    path: Path;
    commits: Layer1WireCommit[];
    onDisk: Layer1WireInstant;
    // Task 298: absent unless the file's birth is trustworthy AND earlier than its mtime.
    created?: Layer1WireInstant;
}

// One bucket row: a path and the single instant that places it.
export interface Layer1WireOrphan extends Layer1WireInstant {
    path: Path;
}

// The Layer 1 View. `pairs`/`gitOrphans`/`diskOrphans` are task 232's property names, passed
// through UNCHANGED — the two orphan sets are mirror images, so a swap is invisible to the
// task-238 acceptance test and must never happen here (S18 "Output contract").
export interface Layer1WireView {
    pairs: Layer1WirePair[];
    gitOrphans: Layer1WireOrphan[];
    diskOrphans: Layer1WireOrphan[];
    // Every distinct instant the view draws, ascending — the page's ruler ticks.
    ruler: Layer1WireRulerTick[];
}

// One git-orphan path with the instant that places it, before the axis is resolved.
interface GitOrphanPlacement {
    path: Path;
    instant: Instant;
}

// One pair with its ladder, before the axis is resolved.
interface PairHistory {
    file: DiskFileState;
    commits: { hash: string; instant: Instant }[];
}

// One announcement, counted or not. Reuses /api/document's ProgressEvent shape rather than
// inventing a second progress vocabulary; `current`/`total` stay absent on the uncounted stages
// (JSON.stringify drops undefined properties).
function reportStage(reportProgress: ProgressSink, label: string, current?: number, total?: number): void {
    reportProgress({ kind: DocumentResponseKind.progress, label, current, total });
}

// One pair's ladder in the order the page draws it: every commit oldest-first, then the on-disk
// node last. This IS the bubble's content — the file name and its sub-line sit in the bubble's own
// fixed padding and consume no ruler, so these node rows are the whole of what task 251 measures,
// and the ruler is charged for exactly them. Order is load-bearing twice over: it decides which
// tied node takes the upper row, and it makes the returned offsets readable positionally below.
// The file's birth, or none when it cannot be believed. A birth LATER than the file's own first
// commit is a checkout or copy time — the file demonstrably existed before then — and drawing it
// would put a `created at` node part-way down the bubble instead of at its top (user, 2026-07-27).
// Every clone reports this: `git clone` stamps today's birthtime on files committed years ago.
function readPairCreatedInstant(pair: PairHistory): Instant | undefined {
    const created = pair.file.createdAt;
    const firstCommit = pair.commits[0]?.instant;
    if (created === undefined || (firstCommit !== undefined && created.getTime() > firstCommit.getTime())) {
        return undefined;
    }
    return created;
}

function listPairNodeLadder(pair: PairHistory): NodeLadder {
    const created = readPairCreatedInstant(pair);
    return [...(created === undefined ? [] : [created]), ...pair.commits.map((commit) => commit.instant), pair.file.mtime];
}

// One pair on the wire, its nodes taking the offsets the layout measured for THIS pair's ladder.
// `nodeOffsetsPx` is parallel to listPairNodeLadder's output, so the commits read off the front in
// the same oldest-first order and the on-disk node is the last entry — by construction, not by a
// lookup, which is what lets two nodes sharing an instant come back on different rows.
function placePairNodesOnAxis(pair: PairHistory, nodeOffsetsPx: number[]): Layer1WirePair {
    const created = readPairCreatedInstant(pair);
    const firstCommit = created === undefined ? 0 : 1;
    return {
        path: pair.file.relativePath,
        ...(created === undefined ? {} : { created: { instant: created, axisPx: nodeOffsetsPx[0]! } }),
        commits: pair.commits.map((commit, node) => ({
            hash: commit.hash,
            instant: commit.instant,
            axisPx: nodeOffsetsPx[firstCommit + node]!,
        })),
        onDisk: { instant: pair.file.mtime, axisPx: nodeOffsetsPx.at(-1)! },
    };
}

// Place one instant on the resolved ruler. Every instant handed out below was part of the resolve
// input, so a miss is a bug in this file rather than bad input — fail loudly instead of drawing a
// node at a silent zero.
function placeInstantOnAxis(offsets: Map<number, number>, instant: Instant): Layer1WireInstant {
    const axisPx = offsets.get(instant.getTime());
    if (axisPx === undefined) {
        throw new Error(`instant ${instant.toISOString()} is missing from the resolved ruler`);
    }
    return { instant, axisPx };
}

// Each git-orphan path's placing instant: its LAST touching commit, since a repo path with no
// on-disk counterpart has no mtime and its most recent commit is the moment it last existed in the
// repo (plans/layer1-mockup.html places a repo-only row the same way).
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

// Bucket rows ascending by instant, so the bucket's placement is simply its first row's axisPx and
// the page needs no Math.min. Re-ordering rows neither renames nor inverts a bucket, so S18's
// output contract is untouched.
function orderRowsByInstant(rows: Layer1WireOrphan[]): Layer1WireOrphan[] {
    return [...rows].sort((left, right) => left.instant.getTime() - right.instant.getTime());
}

// The S18 Layer 1 View of `projectFolder` against `repoDir` at `ref`. `reportProgress` is an
// explicit parameter rather than reconstruction_progress.ts's process-wide sink, which is scoped
// to document builds and would mix this route's lines into one. `timeSource` (task 282) is LAST
// and defaulted, so every existing 3- and 4-argument call is unchanged.
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
    // Runs BEFORE any history read so a bad ref throws once, from the module whose message already
    // names it, rather than degrading into empty ladders. Only `trackedFiles` reaches the pairing:
    // a submodule GITLINK is not a file, so pairing it would invent a phantom repo-only row for
    // each of jfred's four submodules. Their CONTENTS are excluded on the other side by
    // walkCurrentFileState, which asks git and so stops at the same gitlink boundary.
    const repoTree = readRepoTreeAtRef(repoDir, ref);
    const pairing = pairDiskFilesAgainstRepoPaths(diskFiles, repoTree.trackedFiles);
    // One `git log` per tracked path is where this route's ~10 s goes, so each iteration announces
    // its position. ponytail: every item is reported, unbatched — 832 lines over 10 s is not a
    // bottleneck, and a throttle would add a branch needing its own test. Batch into groups here
    // if the line rate ever starts to matter.
    const pairHistories: PairHistory[] = [];
    for (let index = 0; index < pairing.pairs.length; index += 1) {
        const file = pairing.pairs[index]!;
        reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_HISTORY, index + 1, pairing.pairs.length);
        pairHistories.push({ file, commits: listPairCommitHistory(repoDir, file.relativePath, ref, timeSource) });
    }
    const gitOrphanPlacements = listGitOrphanPlacements(repoDir, pairing.gitOrphans, ref, reportProgress, timeSource);
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER);
    // The ladders are the ruler's whole input (task 251). Pair ladders come FIRST and in
    // `pairHistories` order, which is what makes `ladderOffsetsPx[index]` that pair's own rows
    // below. Each orphan instant follows as a ONE-node ladder: a bucket row is a list item that
    // flows inside its bucket rather than a node pinned to the axis, so it must still bound the
    // ruler but must not be charged a stacked row.
    const layout = layOutNodeLadders([
        ...pairHistories.map(listPairNodeLadder),
        ...gitOrphanPlacements.map((placement) => [placement.instant]),
        ...pairing.diskOrphans.map((file) => [file.mtime]),
    ]);
    // Ticks, not node rows: a bucket is placed at its instant's own position on the shared ruler.
    const offsets = new Map(layout.ticks.map((tick) => [tick.instant.getTime(), tick.offsetPx]));
    return {
        // Pair order is the disk walk's path order — not re-sorted.
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

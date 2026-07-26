// The Layer 1 View server surface (task 235, spec S18): what is on disk right now against what the
// repository says. A NEW path beside /api/layered-graph, not a change to it — it reads NO JSONL at
// all, which is what makes the task-238 acceptance test meaningful (it cannot accidentally pass on
// JSONL data). HTTP wiring stays in viewer_server.ts; this file parses the query, composes the five
// layer1_* modules, and serializes (precedent: viewer_api_layered.ts).

import { listPairCommitHistory } from "./layer1_commit_history.ts";
import { walkCurrentFileState, type DiskFileState } from "./layer1_disk_walk.ts";
import { pairDiskFilesAgainstRepoPaths } from "./layer1_pairing.ts";
import { readRepoTreeAtRef } from "./layer1_repo_tree.ts";
import { resolveInstantOffsets } from "./layer1_ruler_axis.ts";
import type { Instant } from "./layered_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";

// The stages this route announces. Named here so the tests assert the same strings the route
// emits rather than re-typing them (precedent: PROGRESS_LABEL_PARSING_RECORDS).
export const LAYER1_PROGRESS_LABEL_WALKING_FOLDER = "walking project folder";
export const LAYER1_PROGRESS_LABEL_READING_TREE = "reading repository tree";
export const LAYER1_PROGRESS_LABEL_READING_HISTORY = "reading file history";
export const LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY = "placing repository-only files";
export const LAYER1_PROGRESS_LABEL_RESOLVING_RULER = "resolving the ruler";

// One placed moment on the wire: the instant, plus the finished pixel offset the page emits as
// --axis-px. The S18 ruler ACCUMULATES, so an offset cannot be derived from its own instant — the
// page must be handed the number (the same contract as task 239's axisOffsetsPx).
export interface Layer1WireInstant {
    instant: Instant;
    axisPx: number;
}

// One commit node of a pair's ladder.
export interface Layer1WireCommit extends Layer1WireInstant {
    hash: string;
}

// One pair: its path relative to BOTH roots, the commits that touched it (oldest first), and its
// current on-disk state — S18's final node.
export interface Layer1WirePair {
    path: Path;
    commits: Layer1WireCommit[];
    onDisk: Layer1WireInstant;
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
    ruler: Layer1WireInstant[];
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

// Resolve the whole view's instants ONCE so widgets, nodes and buckets share one ruler. Keyed by
// epoch ms — the same identity resolveInstantOffsets de-duplicates on, so two Date objects for the
// same moment resolve to one offset.
function mapInstantsToOffsetPixels(instants: Instant[]): Map<number, number> {
    return new Map(resolveInstantOffsets(instants).map((position) => [position.instant.getTime(), position.offsetPx]));
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
function listGitOrphanPlacements(repoDir: Path, gitOrphans: Path[], ref: string, reportProgress: ProgressSink): GitOrphanPlacement[] {
    const placements: GitOrphanPlacement[] = [];
    for (let index = 0; index < gitOrphans.length; index += 1) {
        const orphanPath = gitOrphans[index]!;
        reportStage(reportProgress, LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY, index + 1, gitOrphans.length);
        const lastTouch = listPairCommitHistory(repoDir, orphanPath, ref).at(-1);
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
// to document builds and would mix this route's lines into one.
export function buildLayer1View(
    projectFolder: Path,
    repoDir: Path,
    ref: string,
    reportProgress: ProgressSink = () => {},
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
        pairHistories.push({ file, commits: listPairCommitHistory(repoDir, file.relativePath, ref) });
    }
    const gitOrphanPlacements = listGitOrphanPlacements(repoDir, pairing.gitOrphans, ref, reportProgress);
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER);
    const offsets = mapInstantsToOffsetPixels([
        ...pairHistories.flatMap((pair) => [...pair.commits.map((commit) => commit.instant), pair.file.mtime]),
        ...gitOrphanPlacements.map((placement) => placement.instant),
        ...pairing.diskOrphans.map((file) => file.mtime),
    ]);
    return {
        // Pair order is the disk walk's path order — not re-sorted.
        pairs: pairHistories.map((pair) => ({
            path: pair.file.relativePath,
            commits: pair.commits.map((commit) => ({ hash: commit.hash, ...placeInstantOnAxis(offsets, commit.instant) })),
            onDisk: placeInstantOnAxis(offsets, pair.file.mtime),
        })),
        gitOrphans: orderRowsByInstant(gitOrphanPlacements.map((placement) => ({
            path: placement.path,
            ...placeInstantOnAxis(offsets, placement.instant),
        }))),
        diskOrphans: orderRowsByInstant(pairing.diskOrphans.map((file) => ({
            path: file.relativePath,
            ...placeInstantOnAxis(offsets, file.mtime),
        }))),
        ruler: [...offsets].map(([epochMs, axisPx]) => ({ instant: new Date(epochMs), axisPx })),
    };
}

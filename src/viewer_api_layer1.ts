// Layer 1 View (spec S18): on-disk state against the repository. Reads no JSONL.

import { listPairCommitHistory } from "./layer1_commit_history.ts";
import { listCurrentFileState } from "./layer1_disk_walk.ts";
import { pairDiskFilesAgainstRepoPaths } from "./layer1_pairing.ts";
import { readRepoTreeAtRef } from "./layer1_repo_tree.ts";
import { computeNodeLadderLayout, type NodeLadder } from "../webapp/layer1-ruler-axis.ts";
import { collectViewSnapshotsByRelativePath, listSnapshotInstants } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import type { Instant } from "./layered_types.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { CommitTimeSource, type WireInstantOf, type WireCommitOf, type WireRulerTickOf, type WirePairOf, type WireOrphanOf, type WireLayer1ViewOf } from "../webapp/layer1-wire.ts";
import { buildDiskOrphanRow, buildInstantOnAxis, sortRowsByInstant } from "./viewer_api_layer1_orphan_rows.ts";
import { buildPairOnAxis, listPairNodeLadder, type PairHistory } from "./viewer_api_layer1_pair_place.ts";

// Named so tests assert the same strings the route emits.
export const LAYER1_PROGRESS_LABEL_WALKING_FOLDER = "walking project folder";
export const LAYER1_PROGRESS_LABEL_READING_TREE = "reading repository tree";
export const LAYER1_PROGRESS_LABEL_READING_HISTORY = "reading file history";
export const LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY = "placing repository-only files";
export const LAYER1_PROGRESS_LABEL_RESOLVING_RULER = "resolving the ruler";

// Server instantiation of the wire vocabulary: Date instants, domain Path/Uuid.
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

// Reuses /api/document's ProgressEvent shape rather than a second progress vocabulary.
function reportStage(reportProgress: ProgressSink, label: string, current?: number, total?: number): void {
  reportProgress({ kind: DocumentResponseKind.progress, label, current, total });
}

// A repo path with no on-disk counterpart is placed at its last touching commit.
function listGitOrphanPlacements(repoDir: Path, gitOrphans: Path[], ref: string, reportProgress: ProgressSink, timeSource: CommitTimeSource): GitOrphanPlacement[] {
  const placements: GitOrphanPlacement[] = [];
  for (let index = 0; index < gitOrphans.length; index += 1) {
    const orphanPath = gitOrphans[index]!;
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_PLACING_REPO_ONLY, index + 1, gitOrphans.length);
    const lastTouch = listPairCommitHistory(repoDir, orphanPath, ref, timeSource).at(-1);
    // ponytail: a shallow clone's truncated history can leave no commit; such a row is dropped, not faked.
    if (lastTouch === undefined) {
      continue;
    }
    placements.push({ path: orphanPath, instant: lastTouch.instant });
  }
  return placements;
}

// `reportProgress` is explicit, not the process-wide sink, so document builds do not mix routes.
export function buildLayer1View(
  projectFolder: Path,
  repoDir: Path,
  ref: string,
  reportProgress: ProgressSink = () => {},
  timeSource: CommitTimeSource = CommitTimeSource.committer,
  sessionFiles: readonly Path[] = [],
): Layer1WireView {
  reportStage(reportProgress, LAYER1_PROGRESS_LABEL_WALKING_FOLDER);
  const diskFiles = listCurrentFileState(projectFolder);
  reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_TREE);
  // Runs before any history read so a bad ref throws once.
  const repoTree = readRepoTreeAtRef(repoDir, ref);
  const pairing = pairDiskFilesAgainstRepoPaths(diskFiles, repoTree.trackedFiles);
  // ponytail: one `git log` per path is the slow part; batch if rate matters.
  const pairHistories: PairHistory[] = [];
  for (let index = 0; index < pairing.pairs.length; index += 1) {
    const file = pairing.pairs[index]!;
    reportStage(reportProgress, LAYER1_PROGRESS_LABEL_READING_HISTORY, index + 1, pairing.pairs.length);
    pairHistories.push({ file, commits: listPairCommitHistory(repoDir, file.relativePath, ref, timeSource) });
  }
  const gitOrphanPlacements = listGitOrphanPlacements(repoDir, pairing.gitOrphans, ref, reportProgress, timeSource);
  const snapshotsByPath = collectViewSnapshotsByRelativePath(projectFolder, sessionFiles, reportProgress);
  const listSnapshotsFor = (path: Path): SnapshotPlacement[] | undefined => snapshotsByPath.get(path.toString());
  reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER);
  // Pair ladders come first, so `ladderOffsetsPx[index]` is that pair's rows; a git orphan is one node.
  const ladders: NodeLadder[] = [];
  for (const pair of pairHistories) {
    ladders.push(listPairNodeLadder(pair, listSnapshotsFor(pair.file.relativePath)));
  }
  for (const placement of gitOrphanPlacements) {
    ladders.push([placement.instant]);
  }
  for (const file of pairing.diskOrphans) {
    ladders.push([file.mtime, ...listSnapshotInstants(listSnapshotsFor(file.relativePath))]);
  }
  const reportRulerProgress = (done: number, total: number): void => reportStage(reportProgress, LAYER1_PROGRESS_LABEL_RESOLVING_RULER, done, total);
  const layout = computeNodeLadderLayout(ladders, new Map(), reportRulerProgress);
  const offsets = new Map<number, number>();
  const ruler: Layer1WireView["ruler"] = [];
  for (const tick of layout.ticks) {
    offsets.set(tick.instant.getTime(), tick.offsetPx);
    ruler.push({ instant: tick.instant, axisPx: tick.offsetPx, eventCount: tick.eventCount });
  }
  const pairs: Layer1WirePair[] = [];
  for (let index = 0; index < pairHistories.length; index += 1) {
    const pair = pairHistories[index]!;
    pairs.push(buildPairOnAxis(pair, layout.ladderOffsetsPx[index]!, listSnapshotsFor(pair.file.relativePath)));
  }
  const gitOrphans: Layer1WireOrphan[] = [];
  for (const placement of gitOrphanPlacements) {
    gitOrphans.push({ path: placement.path, ...buildInstantOnAxis(offsets, placement.instant) });
  }
  const diskOrphans: Layer1WireOrphan[] = [];
  const diskOrphanLadderBase = pairHistories.length + gitOrphanPlacements.length;
  for (let index = 0; index < pairing.diskOrphans.length; index += 1) {
    const file = pairing.diskOrphans[index]!;
    diskOrphans.push(buildDiskOrphanRow(file, layout.ladderOffsetsPx[diskOrphanLadderBase + index]!, listSnapshotsFor(file.relativePath)));
  }
  return { pairs, gitOrphans: sortRowsByInstant(gitOrphans), diskOrphans: sortRowsByInstant(diskOrphans), ruler };
}

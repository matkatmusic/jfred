// Task 361 phase 3b: lists files whose last exact copy before the mark ends with a newline.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { CommitTimeSource } from "../webapp/layer1-wire.ts";
import { collectViewSnapshotsByRelativePath } from "./layer1_snapshot_wire.ts";
import type { SnapshotPlacement } from "./layer1_snapshots.ts";
import { Path } from "./structures/domain.ts";
import { readCommittedFileBytes, readWorkingTreeFileBytes } from "./viewer_api_layer1_file.ts";
import { runJfredGit } from "./viewer_api_layer1_jfred_git.ts";
import { readSnapshotFileContent } from "./viewer_api_layer1_snapshot.ts";

const RECORD_MARK = "\x1e";
const FIELD_MARK = "\x1f";
const NEWLINE_BYTE = 0x0a;

export interface ExactCopySource {
  dir: Path;
  repoDir: Path;
  ref: string;
  timeSource: CommitTimeSource;
  sessionFiles: Path[];
}

interface CommitCopy {
  hash: string;
  instant: Date;
}

interface ExactCopy {
  instant: Date;
  readBytes: () => Buffer;
}

function parseCommitHeader(header: string | undefined): CommitCopy {
  const [hash, stamp] = (header ?? "").split(FIELD_MARK);
  if (hash === undefined)
    throw new Error(`git log record has no hash: ${JSON.stringify(header)}`);
  if (stamp === undefined)
    throw new Error(`git log record has no date: ${JSON.stringify(header)}`);
  return { hash, instant: new Date(stamp) };
}

function addCommitRecord(latestByPath: Map<string, CommitCopy>, wantedPaths: Set<string>, record: string, markInstant: Date): void {
  const [header, ...relativePaths] = record.split("\n");
  const copy = parseCommitHeader(header);
  const isAtOrBeforeMark = copy.instant.getTime() <= markInstant.getTime();
  if (!isAtOrBeforeMark)
    return;
  for (const relativePath of relativePaths) {
    const isWanted = wantedPaths.has(relativePath);
    if (isWanted) {
      const isNewestSoFar = !latestByPath.has(relativePath);
      if (isNewestSoFar)
        latestByPath.set(relativePath, copy);
    }
  }
}

// ponytail: a path with a newline or a leading quote is not supported.
function collectLatestCommitsByPath(source: ExactCopySource, relativePaths: string[], markInstant: Date): Map<string, CommitCopy> {
  const stamp = source.timeSource === CommitTimeSource.author ? "%aI" : "%cI";
  const output = runJfredGit(source.repoDir, ["-c", "core.quotepath=false", "log", "--name-only", "--no-renames", `--format=${RECORD_MARK}%H${FIELD_MARK}${stamp}`, source.ref]);
  const wantedPaths = new Set(relativePaths);
  const latestByPath = new Map<string, CommitCopy>();
  for (const record of output.split(RECORD_MARK).slice(1)) {
    addCommitRecord(latestByPath, wantedPaths, record, markInstant);
  }
  return latestByPath;
}

function findLatestSnapshotAtOrBefore(placements: SnapshotPlacement[], markInstant: Date): SnapshotPlacement | undefined {
  let latest: SnapshotPlacement | undefined;
  for (const placement of placements) {
    const isAtOrBeforeMark = placement.instant.getTime() <= markInstant.getTime();
    if (isAtOrBeforeMark) {
      if (!placement.isBackupMissing)
        latest = placement;
    }
  }
  return latest;
}

function readSnapshotCopyBytes(dir: Path, relativePath: string, placement: SnapshotPlacement): Buffer {
  const query = new URLSearchParams({
    snapshotSession: placement.sessionFile.toString(),
    sessionId: placement.sessionId.toString(),
    version: String(placement.version),
    path: relativePath,
    dir: dir.toString(),
  });
  return Buffer.from(readSnapshotFileContent(query).content, "utf8");
}

function buildCommitCopy(source: ExactCopySource, relativePath: string, commit: CommitCopy | undefined): ExactCopy | undefined {
  if (commit === undefined)
    return undefined;
  return { instant: commit.instant, readBytes: () => readCommittedFileBytes(source.repoDir, new Path(relativePath), commit.hash) };
}

function buildSnapshotCopy(source: ExactCopySource, relativePath: string, placements: SnapshotPlacement[], markInstant: Date): ExactCopy | undefined {
  const placement = findLatestSnapshotAtOrBefore(placements, markInstant);
  if (placement === undefined)
    return undefined;
  return { instant: placement.instant, readBytes: () => readSnapshotCopyBytes(source.dir, relativePath, placement) };
}

function buildDiskCopy(source: ExactCopySource, relativePath: string, markInstant: Date): ExactCopy | undefined {
  const isOnDisk = existsSync(join(source.dir.toString(), relativePath));
  if (!isOnDisk)
    return undefined;
  const modifiedInstant = statSync(join(source.dir.toString(), relativePath)).mtime;
  const isAtOrBeforeMark = modifiedInstant.getTime() <= markInstant.getTime();
  if (!isAtOrBeforeMark)
    return undefined;
  return { instant: modifiedInstant, readBytes: () => readWorkingTreeFileBytes(source.dir, new Path(relativePath)) };
}

// Equal instants: the earlier entry wins, so the caller lists commit, snapshot, disk.
function selectLatestCopy(copies: (ExactCopy | undefined)[]): ExactCopy | undefined {
  let latest: ExactCopy | undefined;
  for (const copy of copies) {
    if (copy === undefined)
      continue;
    const latestTime = latest?.instant.getTime() ?? -Infinity;
    const isLater = copy.instant.getTime() > latestTime;
    if (isLater)
      latest = copy;
  }
  return latest;
}

function isEndingWithNewline(copy: ExactCopy | undefined): boolean {
  return copy?.readBytes().at(-1) === NEWLINE_BYTE;
}

// Paths whose last exact copy at or before the mark ends with a newline; no copy means absent.
export function listPathsEndingWithNewline(source: ExactCopySource, relativePaths: string[], markInstant: Date): Set<string> {
  const commitsByPath = collectLatestCommitsByPath(source, relativePaths, markInstant);
  const snapshotsByPath = collectViewSnapshotsByRelativePath(source.dir, source.sessionFiles);
  const pathsEndingWithNewline = new Set<string>();
  for (const relativePath of relativePaths) {
    const commitCopy = buildCommitCopy(source, relativePath, commitsByPath.get(relativePath));
    const snapshotCopy = buildSnapshotCopy(source, relativePath, snapshotsByPath.get(relativePath) ?? [], markInstant);
    const latestCopy = selectLatestCopy([commitCopy, snapshotCopy, buildDiskCopy(source, relativePath, markInstant)]);
    const isLatestCopyEndingWithNewline = isEndingWithNewline(latestCopy);
    if (isLatestCopyEndingWithNewline)
      pathsEndingWithNewline.add(relativePath);
  }
  return pathsEndingWithNewline;
}

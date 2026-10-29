// Reads base-commit evidence (commit time, file content, repo, root) for one file.

import { execSync } from "node:child_process";
import type { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getPathOverrides } from "./reconstruction_overrides.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";

// Returns the committer timestamp, or undefined if unreadable.
export function readCommitTimestamp(repoDir: Path, baseCommit: Uuid): Date | undefined {
  try {
    const gitOutput = execSync(`git show -s --format=%cI ${JSON.stringify(baseCommit.toString())}`, {
      cwd: repoDir.toString(),
      stdio: "pipe",
    });
    const outputText = gitOutput.toString();
    const isoInstant = outputText.trim();
    const timestamp = new Date(isoInstant);
    const timestampMs = timestamp.getTime();
    const isInvalidTimestamp = Number.isNaN(timestampMs);
    if (isInvalidTimestamp) {
      return undefined;
    }
    return timestamp;
  }
  catch {
    return undefined;
  }
}

// Returns the file content at the given commit, or undefined if absent.
export function readCommitFileContent(repoDir: Path, baseCommit: Uuid, relativePath: string): string | undefined {
  try {
    return execSync(`git show ${baseCommit.toString()}:${JSON.stringify(relativePath)}`, {
      cwd: repoDir.toString(),
      stdio: "pipe",
    }).toString();
  }
  catch {
    return undefined;
  }
}

// Returns the first record's cwd as the project root.
export function findFirstRecordCwd(records: TranscriptRecord[]): Path | undefined {
  for (const record of records) {
    const cwd = (record as { cwd?: Path }).cwd;
    if (cwd !== undefined) {
      return cwd;
    }
  }
  return undefined;
}

// task 365: the source (with a root) whose root is the longest ancestor-or-equal prefix of target.
function findLongestEnclosingSource(sources: SourceEntry[], target: Path): { source: SourceEntry; root: Path } | undefined {
  const targetString = target.toString();
  let best: { source: SourceEntry; root: Path } | undefined;
  for (const source of sources) {
    if (source.root === undefined) {
      continue;
    }
    const rootString = source.root.toString();
    const isEnclosing = targetString === rootString || targetString.startsWith(rootString + "/");
    if (!isEnclosing) {
      continue;
    }
    const hasNoBest = best === undefined;
    const bestRootLength = best === undefined ? 0 : best.root.toString().length;
    const isLongerThanBest = rootString.length > bestRootLength;
    const isNewBest = hasNoBest || isLongerThanBest;
    if (isNewBest) {
      best = { source, root: source.root };
    }
  }
  return best;
}

// task 365: finds beacon repo/commit/root per-source when `sources[]` is configured, else today's global values unchanged.
export function findBaseCommitEvidenceForTarget(
  records: TranscriptRecord[],
  target: Path,
): { repoDir: Path; baseCommit: Uuid; relativeRoot: Path } | undefined {
  const overrides = getPathOverrides();
  const sources = overrides.sources;
  const hasNoSources = sources === undefined;
  const hasEmptySources = sources?.length === 0;
  const hasNoUsableSources = hasNoSources || hasEmptySources;
  if (hasNoUsableSources) {
    if (overrides.repoDir === undefined) {
      return undefined;
    }
    if (overrides.baseCommit === undefined) {
      return undefined;
    }
    const relativeRoot = findFirstRecordCwd(records);
    if (relativeRoot === undefined) {
      return undefined;
    }
    return { repoDir: overrides.repoDir, baseCommit: overrides.baseCommit, relativeRoot };
  }
  const enclosing = findLongestEnclosingSource(sources, target);
  if (enclosing === undefined) {
    return undefined;
  }
  const repoDir = enclosing.source.repoDir ?? overrides.repoDir;
  if (repoDir === undefined) {
    return undefined;
  }
  const baseCommit = enclosing.source.baseCommit ?? overrides.baseCommit;
  if (baseCommit === undefined) {
    return undefined;
  }
  return { repoDir, baseCommit, relativeRoot: enclosing.root };
}

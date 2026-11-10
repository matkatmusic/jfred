// engineV3 RepoState: every file git tracks or could track (not gitignored) that exists on disk, as bytes.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { listGitWorkingTreeFiles } from "./layer1_disk_walk.ts";

// File bytes keyed by path relative to the repo root; the Map keys stay private.
export class RepoState {
  private readonly contentByRelativePath = new Map<string, Buffer>();

  set(relativePath: Path, content: Buffer): void {
    this.contentByRelativePath.set(relativePath.toString(), content);
  }

  get(relativePath: Path): Buffer | undefined {
    return this.contentByRelativePath.get(relativePath.toString());
  }

  removePath(relativePath: Path): void {
    this.contentByRelativePath.delete(relativePath.toString());
  }

  containsPath(relativePath: Path): boolean {
    return this.contentByRelativePath.has(relativePath.toString());
  }

  listPaths(): Path[] {
    const paths: Path[] = [];
    for (const relativePath of this.contentByRelativePath.keys()) {
      paths.push(new Path(relativePath));
    }
    return paths;
  }
}

export interface RepoStateDifferences {
  onlyInExpected: Path[];
  onlyInActual: Path[];
  changedContent: Path[];
}

// Reads every tracked or untracked-not-ignored file that exists on disk; throws outside a git repo.
export function readRepoState(repoFolder: Path): RepoState {
  const relativePaths = listGitWorkingTreeFiles(repoFolder);
  if (relativePaths === undefined) {
    throw new Error(`readRepoState: not a git repo: ${repoFolder.toString()}`);
  }
  const state = new RepoState();
  for (const relativePath of relativePaths) {
    const absolutePath = join(repoFolder.toString(), relativePath);
    const isFileOnDisk = isExistingFile(absolutePath);
    if (isFileOnDisk) {
      state.set(new Path(relativePath), readFileSync(absolutePath));
    }
  }
  return state;
}

// False for deleted files and for submodule folders that git lists as one entry.
function isExistingFile(absolutePath: string): boolean {
  const stats = statSync(absolutePath, { throwIfNoEntry: false });
  if (stats === undefined) {
    return false;
  }
  return stats.isFile();
}

function comparePaths(left: Path, right: Path): number {
  return left.toString().localeCompare(right.toString());
}

function sortPaths(paths: Path[]): Path[] {
  return paths.sort(comparePaths);
}

// Paths held by `source` that `other` lacks.
function listPathsMissingFrom(source: RepoState, other: RepoState): Path[] {
  const missing: Path[] = [];
  for (const path of source.listPaths()) {
    const isInOther = other.containsPath(path);
    if (!isInOther) {
      missing.push(path);
    }
  }
  return sortPaths(missing);
}

function isContentChanged(expected: RepoState, actual: RepoState, path: Path): boolean {
  const expectedContent = expected.get(path);
  const actualContent = actual.get(path);
  if (expectedContent === undefined) {
    return false;
  }
  if (actualContent === undefined) {
    return false;
  }
  return !expectedContent.equals(actualContent);
}

// Paths both states hold with different bytes.
function listPathsWithChangedContent(expected: RepoState, actual: RepoState): Path[] {
  const changed: Path[] = [];
  for (const path of expected.listPaths()) {
    const isChanged = isContentChanged(expected, actual, path);
    if (isChanged) {
      changed.push(path);
    }
  }
  return sortPaths(changed);
}

export function findRepoStateDifferences(expected: RepoState, actual: RepoState): RepoStateDifferences {
  return {
    onlyInExpected: listPathsMissingFrom(expected, actual),
    onlyInActual: listPathsMissingFrom(actual, expected),
    changedContent: listPathsWithChangedContent(expected, actual),
  };
}

export function isRepoStateEqual(expected: RepoState, actual: RepoState): boolean {
  const differences = findRepoStateDifferences(expected, actual);
  if (differences.onlyInExpected.length > 0) {
    return false;
  }
  if (differences.onlyInActual.length > 0) {
    return false;
  }
  return differences.changedContent.length === 0;
}

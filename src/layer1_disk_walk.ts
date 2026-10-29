// Layer 1 on-disk file walk: git paths when available, manual walk otherwise.

import { readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";
import { isPathIgnored, readIgnoreRules, type IgnoreRule } from "./layer1_ignore_rules.ts";

// One file on disk: its path relative to the project folder, and its timestamps.
export interface DiskFileState {
  relativePath: Path;
  mtime: Date;
  createdAt?: Date;
  createdNotTrusted?: CreatedNotTrustedReason;
}

// Birthtime is trusted only when real and earlier than mtime; otherwise the reason is kept.
export function readCreatedState(stats: { birthtime: Date; mtime: Date }): Pick<DiskFileState, "createdAt" | "createdNotTrusted"> {
  const birth = stats.birthtime.getTime();
  const mtimeMs = stats.mtime.getTime();
  if (birth <= 0) {
    return { createdNotTrusted: CreatedNotTrustedReason.noBirthTime };
  }
  const isBirthNotBeforeMtime = birth >= mtimeMs;
  if (isBirthNotBeforeMtime) {
    return { createdNotTrusted: CreatedNotTrustedReason.birthNotBeforeMtime };
  }
  return { createdAt: stats.birthtime };
}

// Never walked, with or without a .gitignore (S18).
const ALWAYS_EXCLUDED_NAMES = [".git", "node_modules"];

// Depth-first walk; skips symlinks and sockets since Layer 1 needs real bytes on disk.
function collectFolderFiles(projectFolder: Path, relativeFolder: string, rules: IgnoreRule[], found: DiskFileState[]): void {
  const absoluteFolder = join(projectFolder.toString(), relativeFolder);
  for (const entry of readdirSync(absoluteFolder, { withFileTypes: true })) {
    const isExcludedName = ALWAYS_EXCLUDED_NAMES.includes(entry.name);
    if (isExcludedName) {
      continue;
    }
    const relativePath = relativeFolder === "" ? entry.name : `${relativeFolder}/${entry.name}`;
    const isDirectory = entry.isDirectory();
    const isIgnored = isPathIgnored(relativePath, isDirectory, rules);
    if (isIgnored) {
      continue;
    }
    if (isDirectory) {
      collectFolderFiles(projectFolder, relativePath, rules, found);
      continue;
    }
    const isFile = entry.isFile();
    if (!isFile) {
      continue;
    }
    const stats = statSync(join(absoluteFolder, entry.name));
    found.push({ relativePath: new Path(relativePath), mtime: stats.mtime, ...readCreatedState(stats) });
  }
}

// Git-tracked and untracked paths, or undefined when not in a repo.
function listGitWorkingTreeFiles(projectFolder: Path): string[] | undefined {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: projectFolder.toString(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return undefined;
  }
  const paths: string[] = [];
  for (const path of result.stdout.split("\0")) {
    if (path !== "") {
      paths.push(path);
    }
  }
  return paths;
}

// Git omits `.git` but untracked `node_modules` would flood results without this guard.
function isPathAlwaysExcluded(relativePath: string): boolean {
  for (const segment of relativePath.split("/")) {
    const isExcludedName = ALWAYS_EXCLUDED_NAMES.includes(segment);
    if (isExcludedName) {
      return true;
    }
  }
  return false;
}

// Stats each path; submodule gitlinks and deleted files drop out via the isFile check.
function collectWorkingTreeFiles(projectFolder: Path, relativePaths: string[]): DiskFileState[] {
  const found: DiskFileState[] = [];
  for (const relativePath of relativePaths) {
    const isExcluded = isPathAlwaysExcluded(relativePath);
    if (isExcluded) {
      continue;
    }
    const stats = statSync(join(projectFolder.toString(), relativePath), { throwIfNoEntry: false });
    if (stats === undefined) {
      continue;
    }
    const isFile = stats.isFile();
    if (isFile) {
      found.push({ relativePath: new Path(relativePath), mtime: stats.mtime, ...readCreatedState(stats) });
    }
  }
  return found;
}

function compareByRelativePath(left: DiskFileState, right: DiskFileState): number {
  return left.relativePath.toString() < right.relativePath.toString() ? -1 : 1;
}

// The `current file state` of `projectFolder`, sorted by relative path for determinism.
export function listCurrentFileState(projectFolder: Path): DiskFileState[] {
  const gitPaths = listGitWorkingTreeFiles(projectFolder);
  const found: DiskFileState[] = [];
  if (gitPaths === undefined) {
    collectFolderFiles(projectFolder, "", readIgnoreRules(projectFolder), found);
  }
  else {
    found.push(...collectWorkingTreeFiles(projectFolder, gitPaths));
  }
  return found.sort(compareByRelativePath);
}

// Nested-repo discovery (task 365): finds git repos under a non-repo project root.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";

// Vendor trees and git's own internals are never worth descending into.
const SKIPPED_DIR_NAMES = new Set([".git", "node_modules"]);

// Every git repo at or below rootDir, depth-first, sorted per directory.
export function findNestedRepos(rootDir: Path): Path[] {
  const found: Path[] = [];
  scanForGitRepos(rootDir.toString(), found);
  return found;
}

function scanForGitRepos(dir: string, found: Path[]): void {
  // A configured cwd need not exist on this machine; readdirSync would throw ENOENT.
  const dirExists = existsSync(dir);
  if (!dirExists) {
    return;
  }
  const hasGitEntry = existsSync(join(dir, ".git"));
  if (hasGitEntry) {
    found.push(new Path(dir));
  }
  const entries = readdirSync(dir, { withFileTypes: true });
  const subdirNames: string[] = [];
  for (const entry of entries) {
    const isScannable = entry.isDirectory() && !SKIPPED_DIR_NAMES.has(entry.name);
    if (isScannable) {
      subdirNames.push(entry.name);
    }
  }
  subdirNames.sort();
  for (const subdirName of subdirNames) {
    scanForGitRepos(join(dir, subdirName), found);
  }
}

// Claude Code's project-folder name: non-alphanumerics become "-"; duplicated because webapp cannot import src/.
function encodeProjectFolderName(projectFolder: string): string {
  return projectFolder.replace(/[^a-zA-Z0-9]/g, "-");
}

// One SourceEntry per nested repo with a recorded session; empty when the cwd is itself a repo.
export function findSourceEntriesForProjectRoot(projectCwd: Path): SourceEntry[] {
  const cwdIsRepo = existsSync(join(projectCwd.toString(), ".git"));
  if (cwdIsRepo) {
    return [];
  }
  const nestedRepos = findNestedRepos(projectCwd);
  if (nestedRepos.length === 0) {
    return [];
  }
  const claudeProjectsRoot = join(homedir(), ".claude", "projects");
  const sourceEntries: SourceEntry[] = [];
  for (const repoDir of nestedRepos) {
    const mangledProjectsDir = join(claudeProjectsRoot, encodeProjectFolderName(repoDir.toString()));
    const projectsDirExists = existsSync(mangledProjectsDir);
    if (!projectsDirExists) {
      continue;
    }
    const sessionFileNames = readdirSync(mangledProjectsDir);
    let hasRecordedSession = false;
    for (const name of sessionFileNames) {
      const isSessionFile = name.endsWith(".jsonl");
      if (isSessionFile) {
        hasRecordedSession = true;
        break;
      }
    }
    if (!hasRecordedSession) {
      continue;
    }
    sourceEntries.push({ projectsDir: new Path(mangledProjectsDir), root: repoDir, repoDir });
  }
  return sourceEntries;
}

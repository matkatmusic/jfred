// Fixtures whose folder and repo share no path (S18 acceptance), plus a repo holding a submodule.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeGitCommand, writeFileWithPinnedMtime } from "./layer1-view-test-helpers.ts";

// Kept separate from the layer1-view fixture since three test files depend on its exact ladder; distinct instants prevent ties.
export const UNRELATED_FIRST_COMMIT_INSTANT = "2026-07-01T10:00:00Z";
export const UNRELATED_SECOND_COMMIT_INSTANT = "2026-07-01T15:00:00Z";
export const UNRELATED_FIRST_DISK_MTIME = "2026-07-02T09:00:00Z";
export const UNRELATED_SECOND_DISK_MTIME = "2026-07-02T12:00:00Z";

// Every path is absent from createUnrelatedFixtureRepo, so pairing yields zero pairs, populating both buckets.
export function createUnrelatedFixtureDiskFolder(): string {
  const diskDir = mkdtempSync(join(tmpdir(), "layer1-unrelated-dir-"));
  writeFileWithPinnedMtime(diskDir, "notes.txt", "disk only\n", UNRELATED_FIRST_DISK_MTIME);
  writeFileWithPinnedMtime(diskDir, "todo.md", "disk only too\n", UNRELATED_SECOND_DISK_MTIME);
  return diskDir;
}

// Two single-file commits avoid tie-resolved ordering; nested docs/readme.md proves buckets list repo-relative paths, not basenames.
export function createUnrelatedFixtureRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), "layer1-unrelated-repo-"));
  executeGitCommand(repoDir, "init -q");
  writeFileSync(join(repoDir, "alpha.py"), "print('repo only')\n");
  executeGitCommand(repoDir, "add -A");
  executeGitCommand(repoDir, "commit -q -m first", UNRELATED_FIRST_COMMIT_INSTANT);
  mkdirSync(join(repoDir, "docs"), { recursive: true });
  writeFileSync(join(repoDir, "docs", "readme.md"), "repo only too\n");
  executeGitCommand(repoDir, "add -A");
  executeGitCommand(repoDir, "commit -q -m second", UNRELATED_SECOND_COMMIT_INSTANT);
  return repoDir;
}

// dir === repo makes a gitlink and disk-walk path collide, so submodule exclusion is observable; git needs allow-local-clone enabled.
export const SUBMODULE_FIXTURE_FOLDER = "vendor/lib";

export function createSubmoduleFixtureRoot(): string {
  const innerDir = mkdtempSync(join(tmpdir(), "layer1-submodule-inner-"));
  executeGitCommand(innerDir, "init -q");
  writeFileSync(join(innerDir, "inner.txt"), "belongs to another repository\n");
  executeGitCommand(innerDir, "add -A");
  executeGitCommand(innerDir, "commit -q -m inner", UNRELATED_FIRST_COMMIT_INSTANT);
  const rootDir = mkdtempSync(join(tmpdir(), "layer1-submodule-root-"));
  executeGitCommand(rootDir, "init -q");
  writeFileSync(join(rootDir, "kept.txt"), "tracked here\n");
  executeGitCommand(rootDir, "add -A");
  executeGitCommand(rootDir, "commit -q -m one", UNRELATED_FIRST_COMMIT_INSTANT);
  executeGitCommand(rootDir, `-c protocol.file.allow=always submodule add -q ${innerDir} ${SUBMODULE_FIXTURE_FOLDER}`);
  executeGitCommand(rootDir, "add -A");
  executeGitCommand(rootDir, "commit -q -m submodule", UNRELATED_SECOND_COMMIT_INSTANT);
  return rootDir;
}

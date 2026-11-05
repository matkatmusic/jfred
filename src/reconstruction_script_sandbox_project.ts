// Host git commands that build a replay box: find the commit before a run, clone it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";

const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

// Array form, no shell. A failed git call throws.
function runGit(repo: Path, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo.toString(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repo.toString()}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function hasRef(repo: Path, ref: string): boolean {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: repo.toString() });
  return result.status === 0;
}

export function isGitRepository(repo: Path): boolean {
  return existsSync(join(repo.toString(), ".git"));
}

export function findRepoRoot(repo: Path): Path {
  return new Path(runGit(repo, ["rev-parse", "--show-toplevel"]));
}

// A found branch limits the search to that branch; a missing name or HEAD searches all branches and tags.
export function findCommitBeforeRun(repo: Path, when: Date, branch: string | undefined): Uuid | undefined {
  const before = `--before=${when.toISOString()}`;
  const localRef = `refs/heads/${branch}`;
  const originRef = `refs/remotes/origin/${branch}`;
  const foundRef = [localRef, originRef].find((ref) => branch !== undefined && hasRef(repo, ref));
  const searchArgs = foundRef === undefined ? ["--branches", "--tags"] : [foundRef];
  const commit = runGit(repo, ["rev-list", "-n1", before, ...searchArgs]);
  return commit === "" ? undefined : new Uuid(commit);
}

// A plain-path clone copies every object, so origin-only commits check out without a fetch.
export function cloneProjectAtCommit(repo: Path, commit: Uuid, destination: Path): void {
  runGit(repo, [...NO_HOOKS, "clone", "--quiet", "--no-checkout", "--no-hardlinks", "--template=", repo.toString(), destination.toString()]);
  runGit(destination, [...NO_HOOKS, "checkout", "--quiet", "--detach", commit.toString()]);
}

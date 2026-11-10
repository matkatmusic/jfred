// Host git commands that build a replay box: find the commit before a run, clone it.

import { spawnSync } from "node:child_process";
// import { existsSync } from "node:fs";
// import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";

const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

// Array form, no shell. A failed git call throws.
function executeGit(repo: Path, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo.toString(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repo.toString()}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function isRefPresent(repo: Path, ref: string): boolean {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", ref], { cwd: repo.toString() });
  return result.status === 0;
}

// export function isGitRepository(repo: Path): boolean {
//   return existsSync(join(repo.toString(), ".git"));
// }

export function isInsideGitWorkTree(folder: Path): boolean {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: folder.toString(), encoding: "utf8" });
  if (result.status !== 0) {
    return false;
  }
  return result.stdout.trim() === "true";
}

export function findRepoRoot(repo: Path): Path {
  return new Path(executeGit(repo, ["rev-parse", "--show-toplevel"]));
}

function findBranchRef(repo: Path, branch: string | undefined): string | undefined {
  if (branch === undefined) {
    return undefined;
  }
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const isRefFound = isRefPresent(repo, ref);
    if (isRefFound) {
      return ref;
    }
  }
  return undefined;
}

// A found branch limits the search to that branch; a missing name or HEAD searches all branches and tags.
export function findCommitBeforeRun(repo: Path, when: Date, branch: string | undefined): Uuid | undefined {
  const before = `--before=${when.toISOString()}`;
  const foundRef = findBranchRef(repo, branch);
  const searchArgs = foundRef === undefined ? ["--branches", "--tags"] : [foundRef];
  const commit = executeGit(repo, ["rev-list", "-n1", before, ...searchArgs]);
  return commit === "" ? undefined : new Uuid(commit);
}

// A plain-path clone copies every object, so origin-only commits check out without a fetch.
export function copyProjectAtCommit(repo: Path, commit: Uuid, destination: Path): void {
  executeGit(repo, [...NO_HOOKS, "clone", "--quiet", "--no-checkout", "--no-hardlinks", "--template=", repo.toString(), destination.toString()]);
  executeGit(destination, [...NO_HOOKS, "checkout", "--quiet", "--detach", commit.toString()]);
}

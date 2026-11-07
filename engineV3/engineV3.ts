import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RepoState, readRepoState } from "../src/engine_v3_repo_state.ts";
import { copyProjectAtCommit } from "../src/reconstruction_script_sandbox_project.ts";

//fill these in or import them from the other engine versions
// type RepoState = {
//     // Define the structure of the repository state here
// };

export type CommitHash = Uuid;
// type CommitHash = {
//     //operator for incrementing the commit hash
//
// };

// type Path = {
//
// };
export type JSONLLine = TranscriptRecord;
// type JSONLLine = {
//
// };

type CommitChange = { status: string; path: Path };

const DELETED_STATUS = "D";
const BLOB_STATUSES = ["A", "M", "T"];

function executeGit(repo: Path, args: string[]): Buffer {
  const result = spawnSync("git", args, { cwd: repo.toString(), maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${repo.toString()}: ${result.stderr}`);
  }
  return result.stdout;
}

function listChangesInCommit(commit: CommitHash, repo: Path): CommitChange[] {
  const args = ["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", "--root", "--diff-merges=first-parent", "--name-status", commit.toString()];
  const output = executeGit(repo, args);
  const text = output.toString("utf8");
  const tokens = text.split("\0");
  tokens.pop();
  const changes: CommitChange[] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    changes.push({ status: tokens[index] as string, path: new Path(tokens[index + 1] as string) });
  }
  return changes;
}

function applyChangeToState(change: CommitChange, commit: CommitHash, state: RepoState, repo: Path): void {
  if (change.status === DELETED_STATUS) {
    state.removePath(change.path);
    return;
  }
  const isBlobStatus = BLOB_STATUSES.includes(change.status);
  if (isBlobStatus) {
    state.set(change.path, executeGit(repo, ["cat-file", "blob", `${commit.toString()}:${change.path.toString()}`]));
    return;
  }
  throw new Error(`applyCommitToState: unsupported change status ${change.status} for ${change.path.toString()}`);
}

// Applies the commit's changes to `state` in place, like a cherry-pick of that one commit.
export function applyCommitToState(commit: CommitHash, state: RepoState, repo: Path): RepoState {
  for (const change of listChangesInCommit(commit, repo)) {
    applyChangeToState(change, commit, state, repo);
  }
  return state;
}

export const CHECKOUT_FOLDER_PREFIX = "engine-v3-checkout-";

export function checkOutRepoAt(repo: Path, commit: CommitHash): RepoState {
  const checkoutFolder = new Path(mkdtempSync(join(tmpdir(), CHECKOUT_FOLDER_PREFIX)));
  try {
    copyProjectAtCommit(repo, commit, checkoutFolder);
    return readRepoState(checkoutFolder);
  }
  finally {
    rmSync(checkoutFolder.toString(), { recursive: true, force: true });
  }
}

// Exit code 0 means ancestor, 1 means not an ancestor; anything else throws.
function isAncestorOrEqual(repo: Path, ancestor: CommitHash, descendant: CommitHash): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor.toString(), descendant.toString()], { cwd: repo.toString() });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(`git merge-base --is-ancestor failed in ${repo.toString()}: ${result.stderr}`);
}

function listChildCommits(repo: Path, commit: CommitHash): CommitHash[] {
  const output = executeGit(repo, ["rev-list", "--all", "--children"]);
  const text = output.toString("utf8");
  for (const line of text.split("\n")) {
    const [parent, ...childNames] = line.split(" ");
    const isParentCommit = parent === commit.toString();
    if (isParentCommit) {
      return convertToCommitHashes(childNames);
    }
  }
  return [];
}

function convertToCommitHashes(names: string[]): CommitHash[] {
  const hashes: CommitHash[] = [];
  for (const name of names) {
    hashes.push(new Uuid(name));
  }
  return hashes;
}

export function getChildCommitTowards(repo: Path, currentCommit: CommitHash, endingCommit: CommitHash): CommitHash | undefined {
  const children = listChildCommits(repo, currentCommit);
  for (const child of children) {
    const isChildOnTheWay = isAncestorOrEqual(repo, child, endingCommit);
    if (isChildOnTheWay) {
      return child;
    }
  }
  return children[0];
}

export function isCommitAtOrBefore(repo: Path, commit: CommitHash | undefined, endingCommit: CommitHash): commit is CommitHash {
  if (commit === undefined) {
    return false;
  }
  return isAncestorOrEqual(repo, commit, endingCommit);
}

export function runReplay(repoState:RepoState, startingCommit: CommitHash, endingCommit: CommitHash, repo:Path, snapshots?:Path[], events?:JSONLLine[]) : RepoState {
  let currentCommit: CommitHash | undefined = startingCommit;
  let currentState = repoState;
  do {
    currentState = applyCommitToState(currentCommit, currentState, repo);
    currentCommit = getChildCommitTowards(repo, currentCommit, endingCommit);
  } while( isCommitAtOrBefore(repo, currentCommit, endingCommit) );

  return currentState;
}

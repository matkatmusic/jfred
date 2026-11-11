// Applies git tree changes to the state folder, including submodule pointers, with files read from git.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { executeGit, type CommitHash } from "./engineV3.ts";
import { recordTouchedFilesUnder, recordTouchedPath } from "./engineV3_replay_touched.ts";

type TreeChange = { oldMode: string; newMode: string; oldHash: string; newHash: string; status: string; path: Path };

export const GITLINK_MODE = "160000";
const ADDED_STATUS = "A";
const MODIFIED_STATUS = "M";
const DELETED_STATUS = "D";
const BLOB_STATUSES = ["A", "M", "T"];
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SUBMODULES_FOLDER = "modules";

// The folder's own core.worktree may be missing in a copied .git; these commands never touch a work tree.
export function executeGitWithoutWorkTree(gitFolder: Path, args: string[]): Buffer {
  return executeGit(gitFolder, [`--work-tree=${gitFolder.toString()}`, ...args]);
}

// Raw diff-tree rows are ":oldMode newMode oldHash newHash status", then the path, separated by NUL.
function parseRawChanges(output: Buffer): TreeChange[] {
  const tokens = output.toString("utf8").split("\0");
  tokens.pop();
  const changes: TreeChange[] = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const fields = (tokens[index] as string).slice(1).split(" ");
    const path = new Path(tokens[index + 1] as string);
    changes.push({ oldMode: fields[0] as string, newMode: fields[1] as string, oldHash: fields[2] as string, newHash: fields[3] as string, status: fields[4] as string, path });
  }
  return changes;
}

export function listChangesInCommit(commit: CommitHash, gitFolder: Path): TreeChange[] {
  const args = ["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", "--root", "--diff-merges=first-parent", commit.toString()];
  return parseRawChanges(executeGitWithoutWorkTree(gitFolder, args));
}

function listChangesBetweenCommits(gitFolder: Path, oldCommit: string, newCommit: string): TreeChange[] {
  const args = ["diff-tree", "-r", "-z", "--no-renames", oldCommit, newCommit];
  return parseRawChanges(executeGitWithoutWorkTree(gitFolder, args));
}

export function writeFileIntoState(state: Path, relativePath: Path, content: Buffer): void {
  const target = join(state.toString(), relativePath.toString());
  mkdirSync(dirname(target), { recursive: true });
  recordTouchedPath(target);
  writeFileSync(target, content);
}

function readOldSubmoduleCommit(change: TreeChange): string {
  if (change.status === ADDED_STATUS) {
    return EMPTY_TREE_HASH;
  }
  if (change.status === MODIFIED_STATUS) {
    return change.oldHash;
  }
  throw new Error(`applyChangesToState: unsupported submodule status ${change.status} for ${change.path.toString()}`);
}

// The submodule's git folder is inside the parent git folder, under modules/<path>.
function applySubmoduleChangeToState(change: TreeChange, state: Path, gitFolder: Path): void {
  const submoduleGitFolder = new Path(join(gitFolder.toString(), SUBMODULES_FOLDER, change.path.toString()));
  const submoduleState = new Path(join(state.toString(), change.path.toString()));
  const oldCommit = readOldSubmoduleCommit(change);
  const submoduleChanges = listChangesBetweenCommits(submoduleGitFolder, oldCommit, change.newHash);
  mkdirSync(submoduleState.toString(), { recursive: true });
  applyChangesToState(submoduleChanges, change.newHash, submoduleState, submoduleGitFolder);
}

function applyChangeToState(change: TreeChange, commit: string, state: Path, gitFolder: Path): void {
  const targetPath = join(state.toString(), change.path.toString());
  if (change.newMode === GITLINK_MODE) {
    applySubmoduleChangeToState(change, state, gitFolder);
    return;
  }
  if (change.oldMode === GITLINK_MODE) {
    if (change.status === DELETED_STATUS) {
      recordTouchedFilesUnder(targetPath);
      rmSync(targetPath, { recursive: true });
      return;
    }
  }
  if (change.status === DELETED_STATUS) {
    recordTouchedPath(targetPath);
    // An outside commit may record a deletion that a replayed call already made, so an absent file is fine.
    rmSync(targetPath, { force: true });
    return;
  }
  const isBlobStatus = BLOB_STATUSES.includes(change.status);
  if (isBlobStatus) {
    const content = executeGitWithoutWorkTree(gitFolder, ["cat-file", "blob", `${commit}:${change.path.toString()}`]);
    writeFileIntoState(state, change.path, content);
    return;
  }
  throw new Error(`applyCommitToState: unsupported change status ${change.status} for ${change.path.toString()}`);
}

// Blobs are read from the git folder at `commit`, so a submodule uses its own commit and folder.
export function applyChangesToState(changes: TreeChange[], commit: string, state: Path, gitFolder: Path): void {
  for (const change of changes) {
    applyChangeToState(change, commit, state, gitFolder);
  }
}

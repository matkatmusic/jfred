// Compares the state folder with the repo files at HEAD, submodule files included.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { RepoState, findRepoStateDifferences } from "../src/engine_v3_repo_state.ts";
import { checkOutRepoAt } from "./engineV3.ts";
import { type Layer1RepoTree, pushTreeRecord } from "../src/layer1_repo_tree.ts";
import { executeGitWithoutWorkTree } from "./engineV3_replay_submodule.ts";
import { readHeadCommit } from "./engineV3_replay_timeline.ts";

type TreeEntry = { repoTree: Layer1RepoTree; hash: string };

const SUBMODULES_FOLDER = "modules";

function addFolderFilesToState(folder: string, relativePrefix: string, repoState: RepoState): void {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (relativePrefix === "") {
      if (entry.name === ".git") {
        continue;
      }
      if (entry.name === ".idleState") {
        continue;
      }
    }
    const relativePath = join(relativePrefix, entry.name);
    const absolutePath = join(folder, entry.name);
    if (entry.isDirectory()) {
      addFolderFilesToState(absolutePath, relativePath, repoState);
      continue;
    }
    if (entry.isFile()) {
      repoState.set(new Path(relativePath), readFileSync(absolutePath));
    }
  }
}

// ls-tree runs through executeGitWithoutWorkTree because a copied submodule .git has a missing core.worktree.
function readTreeEntry(gitFolder: Path, commit: string): TreeEntry {
  const output = executeGitWithoutWorkTree(gitFolder, ["ls-tree", "-r", "-z", commit]);
  const repoTree: Layer1RepoTree = { trackedFiles: [], submodulePaths: [] };
  for (const record of output.toString("utf8").split("\0")) {
    if (record !== "") {
      pushTreeRecord(record, repoTree);
    }
  }
  return { repoTree, hash: commit };
}

function addTrackedFilesToState(expected: RepoState, prefix: string, gitFolder: Path, treeEntry: TreeEntry): void {
  for (const trackedFile of treeEntry.repoTree.trackedFiles) {
    const blob = executeGitWithoutWorkTree(gitFolder, ["cat-file", "blob", `${treeEntry.hash}:${trackedFile.toString()}`]);
    expected.set(new Path(join(prefix, trackedFile.toString())), blob);
  }
}

function addSubmodulesToState(expected: RepoState, prefix: string, gitFolder: Path, treeEntry: TreeEntry): void {
  for (const submodulePath of treeEntry.repoTree.submodulePaths) {
    const submoduleCommit = executeGitWithoutWorkTree(gitFolder, ["rev-parse", `${treeEntry.hash}:${submodulePath.toString()}`]).toString("utf8").trim();
    const nestedGitFolder = new Path(join(gitFolder.toString(), SUBMODULES_FOLDER, submodulePath.toString()));
    addSubmoduleFilesToState(expected, join(prefix, submodulePath.toString()), nestedGitFolder, submoduleCommit);
  }
}

function addSubmoduleFilesToState(expected: RepoState, prefix: string, gitFolder: Path, commit: string): void {
  const treeEntry = readTreeEntry(gitFolder, commit);
  addTrackedFilesToState(expected, prefix, gitFolder, treeEntry);
  addSubmodulesToState(expected, prefix, gitFolder, treeEntry);
}

// checkOutRepoAt leaves submodule folders empty, so their files are read from modules/<path>.
function readExpectedHeadState(repoPath: Path, headCommit: string): RepoState {
  const expected = checkOutRepoAt(repoPath, readHeadCommit(repoPath));
  addSubmodulesToState(expected, "", repoPath, readTreeEntry(repoPath, headCommit));
  return expected;
}

function formatPathLines(prefix: string, paths: Path[]): string[] {
  const lines: string[] = [];
  for (const path of paths) {
    lines.push(`${prefix}: ${path.toString()}`);
  }
  return lines;
}

export function compareStateToHead(state: Path, repoPath: Path): string[] {
  const headCommit = readHeadCommit(repoPath).toString();
  const actual = new RepoState();
  addFolderFilesToState(state.toString(), "", actual);
  const differences = findRepoStateDifferences(readExpectedHeadState(repoPath, headCommit), actual);
  const lines = formatPathLines("missing from state", differences.onlyInExpected);
  lines.push(...formatPathLines("extra in state", differences.onlyInActual));
  lines.push(...formatPathLines("different content", differences.changedContent));
  const counts = `${differences.onlyInExpected.length} missing, ${differences.onlyInActual.length} extra, ${differences.changedContent.length} different`;
  lines.push(`check vs HEAD ${headCommit}: ${counts}`);
  return lines;
}

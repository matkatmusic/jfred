// Phase 3d of task 361: create a commit on the hidden jfred branch, or delete the whole branch.

import { runJfredGit } from "./viewer_api_layer1_jfred_git.ts";
import { listChangedFiles } from "./viewer_api_layer1_jfred_compare.ts";
import { buildTreeWithFiles } from "./viewer_api_layer1_jfred_tree.ts";
import { listJfredBranchCommits } from "./viewer_api_layer1_jfred_read.ts";
import { COMMIT_HASH_PATTERN } from "./viewer_api_layer1_file.ts";
import { Path } from "./structures/domain.ts";
import { JFRED_BRANCH_NAME, type WireJfredCommitOf, type WireJfredCommitRequest } from "../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";

const JFRED_BRANCH_REF = `refs/heads/${JFRED_BRANCH_NAME}`;
const ABSENT_REF_HASH = "0".repeat(40);

// Undefined when the jfred branch does not exist yet.
function readJfredTipHash(repoDir: Path): string | undefined {
  const tipHash = runJfredGit(repoDir, ["for-each-ref", "--format=%(objectname)", JFRED_BRANCH_REF]);
  return tipHash === "" ? undefined : tipHash;
}

function findBaseHash(repoDir: Path, baseShortHash: string): string {
  const isCommitHash = COMMIT_HASH_PATTERN.test(baseShortHash);
  if (!isCommitHash)
    throw new Error(`not a commit hash: ${baseShortHash}`);
  return runJfredGit(repoDir, ["rev-parse", "--verify", `${baseShortHash}^{commit}`]);
}

function findParentHash(repoDir: Path, request: WireJfredCommitRequest, tipHash: string | undefined): string {
  if (tipHash === undefined) {
    if (request.parentShortHash !== undefined)
      throw new Error(`the ${JFRED_BRANCH_NAME} branch does not exist, so the commit cannot have a parent: ${request.parentShortHash}`);
    return findBaseHash(repoDir, request.baseShortHash);
  }
  if (request.parentShortHash === undefined)
    throw new Error(`the ${JFRED_BRANCH_NAME} branch exists, so the commit needs a parent`);
  assertParentIsTip(request.parentShortHash, tipHash);
  return tipHash;
}

function assertParentIsTip(parentShortHash: string, tipHash: string): void {
  const isCommitHash = COMMIT_HASH_PATTERN.test(parentShortHash);
  if (!isCommitHash)
    throw new Error(`not a commit hash: ${parentShortHash}`);
  const isParentTip = tipHash.startsWith(parentShortHash);
  if (!isParentTip)
    throw new Error(`stale parent ${parentShortHash}: the ${JFRED_BRANCH_NAME} branch moved to ${tipHash.slice(0, parentShortHash.length)}`);
}

// A second guard: it fires only if listChangedFiles was wrong (the blobs stay unreachable).
function assertTreeChanged(repoDir: Path, parentHash: string, treeHash: string): void {
  const parentTreeHash = runJfredGit(repoDir, ["rev-parse", `${parentHash}^{tree}`]);
  if (parentTreeHash === treeHash)
    throw new Error(`the new tree equals the parent tree ${parentTreeHash}: nothing to commit`);
}

function formatGitDate(instant: Date): string {
  const epochSeconds = Math.floor(instant.getTime() / 1000);
  return `${epochSeconds} +0000`;
}

function createCommitObject(repoDir: Path, treeHash: string, parentHash: string, request: WireJfredCommitRequest, committedAt: Date): string {
  const env = {
    GIT_AUTHOR_DATE: formatGitDate(new Date(request.markInstant)),
    GIT_COMMITTER_DATE: formatGitDate(committedAt),
  };
  return runJfredGit(repoDir, ["commit-tree", treeHash, "-p", parentHash], { env, input: request.message });
}

// Compare-and-swap: the move fails when the branch changed since tipHash was read.
function moveJfredBranch(repoDir: Path, commitHash: string, tipHash: string | undefined): void {
  runJfredGit(repoDir, ["update-ref", JFRED_BRANCH_REF, commitHash, tipHash ?? ABSENT_REF_HASH]);
}

// Undefined means no file changed and nothing was written; the branch is append-only.
export function writeJfredMarkCommit(repoDir: Path, request: WireJfredCommitRequest, committedAt: Date, engineTexts: ReadonlyMap<string, string>, findNewlinePaths: (relativePaths: string[]) => Set<string>): WireJfredCommitOf<Date> | undefined {
  const tipHash = readJfredTipHash(repoDir);
  const parentHash = findParentHash(repoDir, request, tipHash);
  const changedFiles = listChangedFiles(repoDir, parentHash, engineTexts, findNewlinePaths);
  if (changedFiles.size === 0)
    return undefined;
  const treeHash = buildTreeWithFiles(repoDir, parentHash, changedFiles);
  assertTreeChanged(repoDir, parentHash, treeHash);
  const commitHash = createCommitObject(repoDir, treeHash, parentHash, request, committedAt);
  moveJfredBranch(repoDir, commitHash, tipHash);
  return listJfredBranchCommits(repoDir)!.commits.at(-1)!;
}

export function removeJfredBranch(repoDir: Path): void {
  runJfredGit(repoDir, ["branch", "-D", JFRED_BRANCH_NAME]);
}

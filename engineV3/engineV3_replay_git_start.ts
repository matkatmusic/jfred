// Builds the replay start repo: a fresh git repo that holds only the commits that existed at the replay start.

import { Path } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";

export type StartRef = { refName: string; shortHash: string };

// start point = last git action (commit 2716f82 at 2026-10-26T23:57:17Z) before the first chat line
const START_REFS: StartRef[] = [
  { refName: "refs/heads/develop", shortHash: "2716f82" },
  { refName: "refs/heads/master", shortHash: "cb136ca" },
  { refName: "refs/heads/WIP", shortHash: "63e8fdb" },
  { refName: "refs/remotes/origin/master", shortHash: "6510b84" },
];

function readGitText(repo: Path, args: string[]): string {
  return executeGit(repo, args).toString("utf8").trim();
}

function getFullHashes(sourceRepo: Path, startRefs: StartRef[]): string[] {
  const fullHashes: string[] = [];
  for (const startRef of startRefs) {
    fullHashes.push(readGitText(sourceRepo, ["rev-parse", startRef.shortHash]));
  }
  return fullHashes;
}

function setRefs(state: Path, startRefs: StartRef[], fullHashes: string[]): void {
  for (const [index, startRef] of startRefs.entries()) {
    executeGit(state, ["update-ref", startRef.refName, fullHashes[index] as string]);
  }
  executeGit(state, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"]);
  executeGit(state, ["symbolic-ref", "HEAD", "refs/heads/develop"]);
}

export function createStartRepo(sourceRepo: Path, state: Path, startRefs: StartRef[] = START_REFS): void {
  executeGit(state, ["init", "-q"]);
  const fullHashes = getFullHashes(sourceRepo, startRefs);
  executeGit(state, ["fetch", "-q", "--no-tags", sourceRepo.toString(), ...fullHashes]);
  setRefs(state, startRefs, fullHashes);
  const originUrl = readGitText(sourceRepo, ["config", "remote.origin.url"]);
  executeGit(state, ["remote", "add", "origin", originUrl]);
  executeGit(state, ["reset", "-q", "--hard"]);
}

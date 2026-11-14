// Builds the replay start repo: a fresh git repo that holds only the commits that existed at the replay start.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";

// export type StartRef = { refName: string; shortHash: string };

// // start point = last git action (commit 2716f82 at 2026-10-26T23:57:17Z) before the first chat line
// const START_REFS: StartRef[] = [
//   { refName: "refs/heads/develop", shortHash: "2716f82" },
//   { refName: "refs/heads/master", shortHash: "cb136ca" },
//   { refName: "refs/heads/WIP", shortHash: "63e8fdb" },
//   { refName: "refs/remotes/origin/master", shortHash: "6510b84" },
// ];

function readGitText(repo: Path, args: string[]): string {
  return executeGit(repo, args).toString("utf8").trim();
}

export type StartPoint = { refs: { refName: string; fullHash: string }[]; headBranch: string; originHeadTarget: string | undefined };

function listReflogFiles(folder: string): string[] {
  if (!existsSync(folder)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const entryPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...listReflogFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

const ZERO_HASH = "0".repeat(40);

// The new hash of the last reflog entry stamped at or before startTime.
// When every entry is later, the old hash of the first entry; undefined when that hash is all zeros.
function readHashAtTime(reflogFile: string, startTime: Date): string | undefined {
  let hashAtTime: string | undefined;
  let firstOldHash: string | undefined;
  for (const line of readFileSync(reflogFile, "utf8").split("\n")) {
    if (line !== "") {
      const [header] = line.split("\t");
      const headerWords = (header as string).split(" ");
      const entryTime = Number(headerWords[headerWords.length - 2]) * 1000;
      firstOldHash ??= headerWords[0];
      if (entryTime <= startTime.getTime()) {
        hashAtTime = headerWords[1];
      }
    }
  }
  if (hashAtTime !== undefined) {
    return hashAtTime;
  }
  if (firstOldHash === ZERO_HASH) {
    return undefined;
  }
  return firstOldHash;
}

// The branch of the last "checkout: moving from X to Y" at or before startTime; the current HEAD branch when there is none.
function readHeadBranchAtTime(sourceRepo: Path, logsFolder: string, startTime: Date): string {
  let headBranch = readGitText(sourceRepo, ["symbolic-ref", "HEAD"]);
  for (const line of readFileSync(join(logsFolder, "HEAD"), "utf8").split("\n")) {
    const [header, message] = line.split("\t");
    const headerWords = (header as string).split(" ");
    const entryTime = Number(headerWords[headerWords.length - 2]) * 1000;
    const checkout = /^checkout: moving from .+ to (.+)$/.exec(message ?? "");
    if (checkout !== null && entryTime <= startTime.getTime()) {
      headBranch = `refs/heads/${checkout[1]}`;
    }
  }
  return headBranch;
}

export function readStartPoint(sourceRepo: Path, startTime: Date): StartPoint {
  const gitFolder = readGitText(sourceRepo, ["rev-parse", "--absolute-git-dir"]);
  const logsFolder = join(gitFolder, "logs");
  const refs: { refName: string; fullHash: string }[] = [];
  for (const topFolder of ["refs/heads", "refs/remotes"]) {
    for (const reflogFile of listReflogFiles(join(logsFolder, topFolder)).sort()) {
      const refName = relative(logsFolder, reflogFile);
      const fullHash = readHashAtTime(reflogFile, startTime);
      // refs/remotes/origin/HEAD is a symbolic ref, so it is not given a hash
      if (fullHash !== undefined && !refName.endsWith("/HEAD")) {
        refs.push({ refName, fullHash });
      }
    }
  }
  const originHeadTarget = existsSync(join(gitFolder, "refs/remotes/origin/HEAD")) ? readGitText(sourceRepo, ["symbolic-ref", "refs/remotes/origin/HEAD"]) : undefined;
  return { refs, headBranch: readHeadBranchAtTime(sourceRepo, logsFolder, startTime), originHeadTarget };
}

function setRefs(state: Path, startPoint: StartPoint): void {
  for (const ref of startPoint.refs) {
    executeGit(state, ["update-ref", ref.refName, ref.fullHash]);
  }
  if (startPoint.originHeadTarget !== undefined) {
    executeGit(state, ["symbolic-ref", "refs/remotes/origin/HEAD", startPoint.originHeadTarget]);
  }
  executeGit(state, ["symbolic-ref", "HEAD", startPoint.headBranch]);
}

export function createStartRepo(sourceRepo: Path, state: Path, startPoint: StartPoint): void {
  executeGit(state, ["init", "-q"]);
  const fullHashes = startPoint.refs.map((ref) => ref.fullHash);
  executeGit(state, ["fetch", "-q", "--no-tags", sourceRepo.toString(), ...fullHashes]);
  setRefs(state, startPoint);
  const originUrl = readGitText(sourceRepo, ["config", "remote.origin.url"]);
  executeGit(state, ["remote", "add", "origin", originUrl]);
  executeGit(state, ["reset", "-q", "--hard"]);
}

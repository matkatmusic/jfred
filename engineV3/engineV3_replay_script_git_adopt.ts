// Moves HEAD of the state repo to the real commit when both commits hold the same files.

import { spawnSync } from "node:child_process";
import { Path } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";

function isSameFilesAsHead(state: Path, commit: string): boolean {
  return spawnSync("git", ["diff", "--quiet", commit, "HEAD"], { cwd: state.toString() }).status === 0;
}

function isHeadDetached(state: Path): boolean {
  return spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: state.toString() }).status !== 0;
}

// Returns true when HEAD was moved to the real commit; the work tree and index stay as they are.
export function moveHeadToRealCommitWhenSameFiles(state: Path, expectedHash: string, actualHash: string): boolean {
  if (!isSameFilesAsHead(state, expectedHash)) {
    return false;
  }
  const updateArgs = ["update-ref", "HEAD", expectedHash];
  if (isHeadDetached(state)) {
    updateArgs.splice(1, 0, "--no-deref");
  }
  executeGit(state, updateArgs);
  console.log(`adopted real commit ${expectedHash} in place of ${actualHash} (same files, different hash)`);
  return true;
}

// The replay with no --git-repo: no start repo, no git rows and no HEAD checks, so no git command runs against a missing repo.

import { cpSync } from "node:fs";
import { Path } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { createStartRepo, readStartPoint } from "./engineV3_replay_git_start.ts";
import { assertHeadMatchesLog, getGitEnvForCall } from "./engineV3_replay_script_git_env.ts";
import { fillMissingBunLockfile } from "./engineV3_replay_script_lockfile.ts";
import { writeUntrackedStartFiles } from "./engineV3_replay_start_files.ts";

// Every file under the start folder lands in the state folder at the same relative path.
export function copyStartFilesIntoState(startFilesPath: Path | undefined, state: Path): void {
  if (startFilesPath === undefined) {
    return;
  }
  cpSync(startFilesPath.toString(), state.toString(), { recursive: true });
}

export function createStartState(repoPath: Path | undefined, startFilesPath: Path | undefined, state: Path, startTime: Date, writePlaygroundStartFiles: boolean): void {
  if (repoPath === undefined) {
    copyStartFilesIntoState(startFilesPath, state);
    return;
  }
  createStartRepo(repoPath, state, readStartPoint(repoPath, startTime));
  if (writePlaygroundStartFiles) {
    writeUntrackedStartFiles(state);
  }
}

export function getRequiredSourceRepo(sourceRepo: Path | undefined): Path {
  if (sourceRepo === undefined) {
    throw new Error("getRequiredSourceRepo: this step reads the source repo, but --git-repo was not given");
  }
  return sourceRepo;
}

export function getGitEnvForOptionalRepo(command: string, result: BashCallResult, sourceRepo: Path | undefined): Record<string, string> {
  if (sourceRepo === undefined) {
    return {};
  }
  return getGitEnvForCall(command, result, sourceRepo);
}

export function assertHeadMatchesLogInOptionalRepo(command: string, result: BashCallResult, sourceRepo: Path | undefined, state: Path, output: { stdout: string; stderr: string }): void {
  if (sourceRepo === undefined) {
    return;
  }
  assertHeadMatchesLog(command, result, sourceRepo, state, output);
}

export function fillMissingBunLockfileFromOptionalRepo(state: Path, run: ScriptRun, sourceRepo: Path | undefined): void {
  if (sourceRepo === undefined) {
    return;
  }
  fillMissingBunLockfile(state, run, sourceRepo);
}

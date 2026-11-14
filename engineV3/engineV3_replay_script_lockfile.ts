// Before a recorded `bun install` with no bun.lock, writes the bun.lock of the next real commit that has it, because the replay has no network.

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { convertToProjectRelativePath } from "../src/layer1_snapshot_wire.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { executeGit } from "./engineV3.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";

const BUN_INSTALL_TEXT = "bun install";
const BUN_LOCKFILE_NAME = "bun.lock";
// const CD_THEN_BUN_INSTALL = /cd\s+(\S+)\s*&&\s*bun install/;
// const CD_THEN_BUN_INSTALL = /cd\s+([^\s;&]+)\s*(?:&&|;)\s*bun install/;
const CD_THEN_BUN_INSTALL = /cd\s+([^\s;&]+)\s*(?:&&|;)\s*\(?\s*bun install/;
const QUOTE_CHARACTERS = /^["']|["']$/g;

function findInstallFolder(run: ScriptRun): string {
  if (run.cwd === undefined) {
    throw new Error(`findInstallFolder: the Bash call has no cwd\ncommand: ${run.code}`);
  }
  const match = CD_THEN_BUN_INSTALL.exec(run.code);
  if (match === null) {
    return run.cwd.toString();
  }
  return resolve(run.cwd.toString(), (match[1] as string).replace(QUOTE_CHARACTERS, ""));
}

// Undefined when no commit ever holds the path: there is nothing to fill from.
function findNextCommitWithFile(sourceRepo: Path, repoPath: string, notBefore: Date): string | undefined {
  const output = executeGit(sourceRepo, ["log", "--all", "--reverse", "--format=%H %ct", "--", repoPath]).toString("utf8");
  if (output.trim() === "") {
    return undefined;
  }
  for (const row of output.split("\n")) {
    if (row === "") {
      continue;
    }
    const separatorIndex = row.indexOf(" ");
    const committerSeconds = Number(row.slice(separatorIndex + 1));
    if (committerSeconds * 1000 >= notBefore.getTime()) {
      return row.slice(0, separatorIndex);
    }
  }
  throw new Error(`findNextCommitWithFile: no commit at or after ${notBefore.toISOString()} has ${repoPath}`);
}

export function fillMissingBunLockfile(state: Path, run: ScriptRun, sourceRepo: Path): void {
  if (!run.code.includes(BUN_INSTALL_TEXT)) {
    return;
  }
  const lockfile = join(findInstallFolder(run), BUN_LOCKFILE_NAME);
  const repoPath = convertToProjectRelativePath(state, lockfile);
  if (repoPath === undefined) {
    return;
  }
  if (existsSync(lockfile)) {
    return;
  }
  const commit = findNextCommitWithFile(sourceRepo, repoPath, run.timestamp);
  if (commit === undefined) {
    return;
  }
  writeFileIntoState(state, new Path(repoPath), executeGit(sourceRepo, ["show", `${commit}:${repoPath}`]));
}

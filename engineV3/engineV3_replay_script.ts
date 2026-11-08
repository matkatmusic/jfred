// Runs the one allowed recorded Bash call for real inside the state folder.

import { spawnSync } from "node:child_process";
import { Path, Uuid } from "../src/structures/domain.ts";
import { listRunsInRecord, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BashResult } from "../src/structures/tool-result-shapes.ts";
import type { JSONLLine } from "./engineV3.ts";

const SCRIPT_TOOL_USE_IDS: Uuid[] = [new Uuid("toolu_015g1bMDjc15AW4kwTpRjKvK")];
const SCRIPT_TIMEOUT_MILLISECONDS = 120000;

function isAllowedToolUseId(toolUseId: Uuid | undefined): boolean {
  if (toolUseId === undefined) {
    return false;
  }
  for (const allowedId of SCRIPT_TOOL_USE_IDS) {
    const isSameId = allowedId.equals(toolUseId);
    if (isSameId) {
      return true;
    }
  }
  return false;
}

// Only an assistant line with a Bash call yields a run, so result and blob lines give none.
export function findScriptRun(line: JSONLLine): ScriptRun | undefined {
  for (const run of listRunsInRecord(line)) {
    const isAllowed = isAllowedToolUseId(run.toolUseId);
    if (isAllowed) {
      return run;
    }
  }
  return undefined;
}

function assertCwdInsideState(state: Path, cwd: Path | undefined): Path {
  if (cwd === undefined) {
    throw new Error("assertCwdInsideState: the script line has no cwd");
  }
  const stateText = state.toString().replace(/\/$/, "");
  const isState = cwd.toString() === stateText;
  const isInsideState = cwd.toString().startsWith(stateText + "/");
  if (isState) {
    return cwd;
  }
  if (isInsideState) {
    return cwd;
  }
  throw new Error(`assertCwdInsideState: cwd ${cwd.toString()} is outside the state folder ${stateText}`);
}

function executeScriptCommand(command: string, cwd: Path): BashResult {
  const result = spawnSync("bash", ["-c", command], { cwd: cwd.toString(), timeout: SCRIPT_TIMEOUT_MILLISECONDS, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`executeScriptCommand: command failed with exit code ${result.status} signal ${result.signal} error ${result.error?.message}\ncommand: ${command}\nstderr: ${result.stderr}`);
  }
  return { stdout: result.stdout, stderr: result.stderr, interrupted: false, isImage: false, noOutputExpected: false };
}

export function executeScriptInState(state: Path, line: JSONLLine): Path {
  const run = findScriptRun(line);
  if (run === undefined) {
    throw new Error("executeScriptInState: the line is not an allowed script call");
  }
  const cwd = assertCwdInsideState(state, run.cwd);
  executeScriptCommand(run.code, cwd);
  return state;
}

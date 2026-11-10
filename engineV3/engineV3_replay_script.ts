// Runs the one allowed recorded Bash call for real inside the state folder.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Path, Uuid } from "../src/structures/domain.ts";
import { listRunsInRecord, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BashResult } from "../src/structures/tool-result-shapes.ts";
import type { JSONLLine } from "./engineV3.ts";

export type ScriptAllowEntry = { toolUseId: Uuid; expectsError: boolean; file: string; line: number };
export type AllowedScriptRun = { run: ScriptRun; entry: ScriptAllowEntry };
type ScriptAllowEntryRecord = { toolUseId: string; expectsError: boolean; file: string; line: number };

// const SCRIPT_TOOL_USE_IDS: Uuid[] = [
//   new Uuid("toolu_015g1bMDjc15AW4kwTpRjKvK"),
//   new Uuid("toolu_01VBAyMPNnP1Mk4huzvaggVT"),
//   new Uuid("toolu_019suXsjCfrijR4SbdPQCYJQ"),
//   new Uuid("toolu_01KZsQLCubvTSwvFRypZFTgN"),
// ];
const SCRIPT_TIMEOUT_MILLISECONDS = 120000;

function loadScriptAllowlist(): ScriptAllowEntry[] {
  const allowlistFile = fileURLToPath(new URL("./engineV3_script_allowlist.json", import.meta.url));
  const records = JSON.parse(readFileSync(allowlistFile, "utf8")) as ScriptAllowEntryRecord[];
  const entries: ScriptAllowEntry[] = [];
  for (const record of records) {
    entries.push({ ...record, toolUseId: new Uuid(record.toolUseId) });
  }
  return entries;
}

export const SCRIPT_ALLOWLIST: ScriptAllowEntry[] = loadScriptAllowlist();

// function isAllowedToolUseId(toolUseId: Uuid | undefined): boolean {
//   if (toolUseId === undefined) {
//     return false;
//   }
//   for (const allowedId of SCRIPT_TOOL_USE_IDS) {
//     const isSameId = allowedId.equals(toolUseId);
//     if (isSameId) {
//       return true;
//     }
//   }
//   return false;
// }

function findAllowEntry(toolUseId: Uuid | undefined): ScriptAllowEntry | undefined {
  if (toolUseId === undefined) {
    return undefined;
  }
  for (const entry of SCRIPT_ALLOWLIST) {
    const isSameId = entry.toolUseId.equals(toolUseId);
    if (isSameId) {
      return entry;
    }
  }
  return undefined;
}

// Only an assistant line with a Bash call yields a run, so result and blob lines give none.
export function findScriptRun(line: JSONLLine): AllowedScriptRun | undefined {
  for (const run of listRunsInRecord(line)) {
    const entry = findAllowEntry(run.toolUseId);
    if (entry !== undefined) {
      return { run, entry };
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

function createFailureError(result: SpawnSyncReturns<string>, command: string): Error {
  return new Error(`executeScriptCommand: command failed with exit code ${result.status} signal ${result.signal} error ${result.error?.message}\ncommand: ${command}\nstderr: ${result.stderr}`);
}

function assertExitMatchesExpectation(result: SpawnSyncReturns<string>, command: string, expectsError: boolean): void {
  if (result.status === null) {
    throw createFailureError(result, command);
  }
  if (expectsError) {
    if (result.status === 0) {
      throw new Error(`executeScriptCommand: command was expected to fail but exited 0\ncommand: ${command}`);
    }
    return;
  }
  if (result.status !== 0) {
    throw createFailureError(result, command);
  }
}

function executeScriptCommand(command: string, cwd: Path, expectsError: boolean): BashResult {
  const result = spawnSync("bash", ["-c", command], { cwd: cwd.toString(), timeout: SCRIPT_TIMEOUT_MILLISECONDS, encoding: "utf8" });
  assertExitMatchesExpectation(result, command, expectsError);
  return { stdout: result.stdout, stderr: result.stderr, interrupted: false, isImage: false, noOutputExpected: false };
}

export function executeScriptInState(state: Path, line: JSONLLine): Path {
  const allowedRun = findScriptRun(line);
  if (allowedRun === undefined) {
    throw new Error("executeScriptInState: the line is not an allowed script call");
  }
  const cwd = assertCwdInsideState(state, allowedRun.run.cwd);
  executeScriptCommand(allowedRun.run.code, cwd, allowedRun.entry.expectsError);
  return state;
}

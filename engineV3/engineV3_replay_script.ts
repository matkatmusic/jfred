// Runs every recorded Bash call for real inside the replay, except the calls that never ran or run only on the Mac.

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { listRunsInRecord, ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { getSessionId } from "../src/reconstruction_multi_source_paths.ts";
import type { JSONLLine } from "./engineV3.ts";
import { isNeverRanResult, type BashCallResult } from "./engineV3_replay_bash_results.ts";
import { getTailOfOutput } from "./engineV3_replay_script_git_env.ts";
import { assertHeadMatchesLogInOptionalRepo, fillMissingBunLockfileFromOptionalRepo, getGitEnvForOptionalRepo, getRequiredSourceRepo } from "./engineV3_replay_no_git.ts";
import { fillMacOnlyFiles, isMacOnlyCommand } from "./engineV3_replay_script_skip.ts";

export type ScriptReplayContext = { bashCallResults: Map<string, BashCallResult>; writeEditResultLines: Map<string, JSONLLine>; sourceRepo: Path | undefined; macPlatePath?: Path; jotPath?: Path; fileHistoryPath?: Path; forkedMessageIds?: Set<string>; earlierSiblingMessageIds?: Map<string, string[]>; resultTurnSnapshotIds?: Map<string, string> };

const SCRIPT_TIMEOUT_MILLISECONDS = 120000;
const SCRIPT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const MAC_HOME_FOLDER = "/Users/matkatmusicllc";
const PYTHON_LANGUAGE = "python";

// The Bash tool has no language; a ctx_execute shell run has one.
function isBashToolRun(run: ScriptRun): boolean {
  if (run.executorKind !== ScriptExecutorKind.bash) {
    return false;
  }
  return run.language === undefined;
}

function isShellCtxExecuteRun(run: ScriptRun): boolean {
  if (run.executorKind !== ScriptExecutorKind.bash) {
    return false;
  }
  return run.language !== undefined;
}

function isPythonCtxExecuteRun(run: ScriptRun): boolean {
  return run.language === PYTHON_LANGUAGE;
}

function getInterpreter(run: ScriptRun): string {
  if (isPythonCtxExecuteRun(run)) {
    return "python";
  }
  if (isShellCtxExecuteRun(run)) {
    return "bash";
  }
  return "zsh";
}

// Only an assistant line with Bash or python or shell ctx_execute calls yields runs, so result and blob lines give none.
export function findScriptRun(line: JSONLLine): ScriptRun[] | undefined {
  const scriptRuns: ScriptRun[] = [];
  for (const run of listRunsInRecord(line)) {
    if (isBashToolRun(run)) {
      scriptRuns.push(run);
    }
    if (isShellCtxExecuteRun(run)) {
      scriptRuns.push(run);
    }
    if (isPythonCtxExecuteRun(run)) {
      scriptRuns.push(run);
    }
  }
  if (scriptRuns.length === 0) {
    return undefined;
  }
  return scriptRuns;
}

function createFailureError(result: SpawnSyncReturns<string>, command: string): Error {
  return new Error(`executeScriptCommand: command failed with exit code ${result.status} signal ${result.signal} error ${result.error?.message}\ncommand: ${command}\nstderr: ${result.stderr}\nstdout: ${getTailOfOutput(result.stdout)}`);
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

function getRunCwd(run: ScriptRun): Path {
  if (run.cwd === undefined) {
    throw new Error(`getRunCwd: the Bash call has no cwd\ncommand: ${run.code}`);
  }
  return run.cwd;
}

// A python ctx_execute run starts in its own empty temp folder (the traceback shows .ctx-mode-XXXX/script.py), not in the project folder.
function getScriptCwd(run: ScriptRun): string {
  // if (isPythonCtxExecuteRun(run)) {
  if (isPythonCtxExecuteRun(run) && run.hasInputCwd !== true) {
    return mkdtempSync(join(tmpdir(), ".ctx-mode-"));
  }
  const cwd = getRunCwd(run).toString();
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

// A recorded hook command such as `node ~/.claude/hooks/turn-done.ts` reads CLAUDE_CODE_SESSION_ID; a line with no sessionId leaves it unset (spawnSync drops undefined values).
function executeScriptCommand(state: Path, run: ScriptRun, result: BashCallResult, context: ScriptReplayContext, sessionId: Uuid | undefined): void {
  const cwd = getScriptCwd(run);
  const gitEnv = getGitEnvForOptionalRepo(run.code, result, context.sourceRepo);
  // const env = { ...process.env, HOME: MAC_HOME_FOLDER, ...gitEnv };
  const env = { ...process.env, HOME: MAC_HOME_FOLDER, CLAUDE_CODE_SESSION_ID: sessionId?.toString(), ...gitEnv };
  // const spawned = spawnSync("bash", ["-c", run.code], { cwd, timeout: SCRIPT_TIMEOUT_MILLISECONDS, encoding: "utf8", maxBuffer: SCRIPT_MAX_BUFFER_BYTES, env });
  const spawned = spawnSync(getInterpreter(run),["-c", run.code], { cwd, timeout: SCRIPT_TIMEOUT_MILLISECONDS, encoding: "utf8", maxBuffer: SCRIPT_MAX_BUFFER_BYTES, env });
  assertExitMatchesExpectation(spawned, run.code, result.isError);
  assertHeadMatchesLogInOptionalRepo(run.code, result, context.sourceRepo, state, spawned);
}

function executeScriptRun(state: Path, run: ScriptRun, context: ScriptReplayContext, sessionId: Uuid | undefined): void {
  const toolUseId = run.toolUseId as Uuid;
  const result = context.bashCallResults.get(toolUseId.toString());
  if (result === undefined) {
    throw new Error(`executeScriptRun: no recorded result for Bash call ${toolUseId.toString()}\ncommand: ${run.code}`);
  }
  if (isNeverRanResult(result)) {
    return;
  }
  if (isMacOnlyCommand(run.code)) {
    fillMacOnlyFiles(state, toolUseId, getRequiredSourceRepo(context.sourceRepo));
    return;
  }
  fillMissingBunLockfileFromOptionalRepo(state, run, context.sourceRepo);
  executeScriptCommand(state, run, result, context, sessionId);
}

export function executeScriptInState(state: Path, line: JSONLLine, context: ScriptReplayContext): Path {
  const runs = findScriptRun(line);
  if (runs === undefined) {
    throw new Error("executeScriptInState: the line holds no Bash call");
  }
  for (const run of runs) {
    executeScriptRun(state, run, context, getSessionId(line));
  }
  return state;
}

// The allow list is off: every Bash call runs. The old code is kept below.
// export type ScriptAllowEntry = { toolUseId: Uuid; expectsError: boolean; file: string; line: number };
// export type AllowedScriptRun = { run: ScriptRun; entry: ScriptAllowEntry };
// type ScriptAllowEntryRecord = { toolUseId: string; expectsError: boolean; file: string; line: number };
// function loadScriptAllowlist(): ScriptAllowEntry[] {
//   const allowlistFile = fileURLToPath(new URL("./engineV3_script_allowlist.json", import.meta.url));
//   const records = JSON.parse(readFileSync(allowlistFile, "utf8")) as ScriptAllowEntryRecord[];
//   const entries: ScriptAllowEntry[] = [];
//   for (const record of records) {
//     entries.push({ ...record, toolUseId: new Uuid(record.toolUseId) });
//   }
//   return entries;
// }
// export const SCRIPT_ALLOWLIST: ScriptAllowEntry[] = loadScriptAllowlist();
// function findAllowEntry(toolUseId: Uuid | undefined): ScriptAllowEntry | undefined {
//   if (toolUseId === undefined) {
//     return undefined;
//   }
//   for (const entry of SCRIPT_ALLOWLIST) {
//     const isSameId = entry.toolUseId.equals(toolUseId);
//     if (isSameId) {
//       return entry;
//     }
//   }
//   return undefined;
// }
// function assertCwdInsideState(state: Path, cwd: Path | undefined): Path {
//   if (cwd === undefined) {
//     throw new Error("assertCwdInsideState: the script line has no cwd");
//   }
//   const stateText = state.toString().replace(/\/$/, "");
//   const isState = cwd.toString() === stateText;
//   const isInsideState = cwd.toString().startsWith(stateText + "/");
//   if (isState) {
//     return cwd;
//   }
//   if (isInsideState) {
//     return cwd;
//   }
//   throw new Error(`assertCwdInsideState: cwd ${cwd.toString()} is outside the state folder ${stateText}`);
// }

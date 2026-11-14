// Runs every recorded Bash call for real inside the replay, except the calls that never ran or run only on the Mac.
// A call that changes no file is skipped too.

import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { lstatSync, mkdtempSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { listRunsInRecord, ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { getSessionId } from "../src/reconstruction_multi_source_paths.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { AttachmentEntry } from "../src/structures/session-meta.ts";
import { isNeverRanResult, type BashCallResult } from "./engineV3_replay_bash_results.ts";
import { getTailOfOutput } from "./engineV3_replay_script_git_env.ts";
import { assertHeadMatchesLogInOptionalRepo, fillMissingBunLockfileFromOptionalRepo, getGitEnvForOptionalRepo, getRequiredSourceRepo } from "./engineV3_replay_no_git.ts";
// import { fillMacOnlyFiles, isMacOnlyCommand, isMacOnlyScriptRun } from "./engineV3_replay_script_skip.ts";
import { fillMacOnlyFiles, isBrowserTestWithNoProjectWrite, isChromeStartCommand, isMacOnlyCommand, isMacOnlyScriptRun, readScriptTextFromDisk, writeHeredocFiles } from "./engineV3_replay_script_skip.ts";
import { isReadOnlyCommand } from "./engineV3_replay_script_internet.ts";
import { fillOutsideGitFoldersAtTime, OUTSIDE_LIVE_ROOT } from "./engineV3_replay_outside_folders.ts";
import { getRecordedUuidEnv } from "./engineV3_replay_new_uuids.ts";
import { recordContinuedFailure } from "./engineV3_replay_backups.ts";
import { replaceDebtReportCall } from "./engineV3_replay_debt_report.ts";
import { CLAUDE_CODE_ENV, replayBlockedTestRun } from "./engineV3_replay_blocked_test_run.ts";
import { createLinkedWorktreeWhenCommandNamesIt, PLAYGROUND_TEST_WORKTREE } from "./engineV3_replay_test_worktree.ts";
import { createFolderOwnedByReplay, recordReplayOwnFile, type ExitMismatch } from "./engineV3_replay_exit_mismatch.ts";
import { getRecordSource } from "../src/parse/loadTranscript.ts";

// export type ScriptReplayContext = { bashCallResults: Map<string, BashCallResult>; writeEditResultLines: Map<string, JSONLLine>; sourceRepo: Path | undefined; macPlatePath?: Path; jotPath?: Path; fileHistoryPath?: Path; forkedMessageIds?: Set<string>; earlierSiblingMessageIds?: Map<string, string[]>; resultTurnSnapshotIds?: Map<string, string> };
// export type ScriptReplayContext = { bashCallResults: Map<string, BashCallResult>; writeEditResultLines: Map<string, JSONLLine>; sourceRepo: Path | undefined; macPlatePath?: Path; jotPath?: Path; fileHistoryPath?: Path; forkedMessageIds?: Set<string>; earlierSiblingMessageIds?: Map<string, string[]>; resultTurnSnapshotIds?: Map<string, string>; postToolHookRewrites?: Map<string, AttachmentEntry> };
export type ScriptReplayContext = { bashCallResults: Map<string, BashCallResult>; writeEditResultLines: Map<string, JSONLLine>; sourceRepo: Path | undefined; macPlatePath?: Path; jotPath?: Path; fileHistoryPath?: Path; forkedMessageIds?: Set<string>; earlierSiblingMessageIds?: Map<string, string[]>; resultTurnSnapshotIds?: Map<string, string>; claudeTempFolder?: Path; postToolHookRewrites?: Map<string, AttachmentEntry>; outsideGitFolders?: Path[]; newOutputUuids?: Map<string, Uuid[]>; scriptTimeoutMilliseconds?: number };

export const SCRIPT_TIMEOUT_MILLISECONDS = 300000;
const BACKGROUND_FIRST_OUTPUT_TIMEOUT_MILLISECONDS = 30000;
const RUN_START_MARKER_FILE = join(tmpdir(), "engineV3-run-start-marker");
const MAX_NOTE_STDERR_CHARACTERS = 200;
const TIMEOUT_ERROR_CODE = "ETIMEDOUT";
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

// replaced by findExitMismatchError: a mismatch no longer throws before the event's file changes are known (user 2026-11-13)
// function assertExitMatchesExpectation(result: SpawnSyncReturns<string>, command: string, expectsError: boolean): void {
//   if (result.status === null) {
//     throw createFailureError(result, command);
//   }
//   if (expectsError) {
//     if (result.status === 0) {
//       throw new Error(`executeScriptCommand: command was expected to fail but exited 0\ncommand: ${command}`);
//     }
//     return;
//   }
//   if (result.status !== 0) {
//     throw createFailureError(result, command);
//   }
// }

function getRunSourceText(run: ScriptRun): string {
  if (run.source === undefined) {
    throw new Error(`getRunSourceText: the Bash call has no JSONL file and line\ncommand: ${run.code}`);
  }
  return `${basename(run.source.filePath)}:${run.source.lineNumber}`;
}

// New content each time, so the write always moves the marker's change time; the kernel clock that stamps it also stamps the project's files.
function readRunStartChangeTime(): bigint {
  writeFileSync(RUN_START_MARKER_FILE, process.hrtime.bigint().toString());
  return lstatSync(RUN_START_MARKER_FILE, { bigint: true }).ctimeNs;
}

// Every write, create, delete, rename or mode change moves a change time, also under .git and in ignored folders.
function isEntryChangedSince(entryPath: string, runStartChangeTime: bigint): boolean {
  const stats = lstatSync(entryPath, { bigint: true });
  if (stats.ctimeNs >= runStartChangeTime) {
    return true;
  }
  if (!stats.isDirectory()) {
    return false;
  }
  for (const name of readdirSync(entryPath)) {
    if (isEntryChangedSince(join(entryPath, name), runStartChangeTime)) {
      return true;
    }
  }
  return false;
}

function isTimeoutError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === TIMEOUT_ERROR_CODE;
}

// The user's rule: only calls that change a file matter. A program that never started is not a failure of the call.
// Only a call that the record shows as a success goes on; a call that the record shows as an error is settled by findExitMismatchError.
function isFailureOfRecordedSuccessThatChangedNoProjectFile(result: SpawnSyncReturns<string>, recordedIsError: boolean, state: Path, runStartChangeTime: bigint): boolean {
  if (recordedIsError) {
    return false;
  }
  if (result.status === 0) {
    return false;
  }
  // merge: an exit code is settled by settleExitMismatches (typesafe 2026-11-13); only a timeout or signal goes on here.
  if (result.status !== null) {
    return false;
  }
  if (result.error !== undefined) {
    if (!isTimeoutError(result.error)) {
      return false;
    }
  }
  return !isEntryChangedSince(state.toString(), runStartChangeTime);
}

function getFirstStderrLine(result: SpawnSyncReturns<string>): string {
  const firstLine = result.stderr.split("\n")[0] as string;
  return firstLine.slice(0, MAX_NOTE_STDERR_CHARACTERS);
}

// A signal or a timeout is no exit code, so it still throws at once. An exit code that differs from the record comes back as an error for the caller to settle.
// function findExitMismatchError(result: SpawnSyncReturns<string>, command: string, expectsError: boolean): Error | undefined {
function findExitMismatchError(result: SpawnSyncReturns<string>, run: ScriptRun, cwd: string, expectsError: boolean): Error | undefined {
  const command = run.code;
  if (result.status === null) {
    throw createFailureError(result, command);
  }
  if (expectsError) {
    if (result.status === 0) {
      // User decision 10: the container's Chromium can start in time where the Mac's Chrome did not.
      if (isChromeStartCommand(command, new Path(cwd))) {
        console.log(`${new Date().toISOString()} note: succeeded where the Mac failed: ${getRunSourceText(run)} (Chrome call)`);
        return undefined;
      }
      return new Error(`executeScriptCommand: command was expected to fail but exited 0\ncommand: ${command}`);
    }
    return undefined;
  }
  if (result.status !== 0) {
    return createFailureError(result, command);
  }
  return undefined;
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
    const ctxModeFolder = mkdtempSync(join(tmpdir(), ".ctx-mode-"));
    recordReplayOwnFile(ctxModeFolder);
    return ctxModeFolder;
  }
  const cwd = getRunCwd(run).toString();
  createFolderOwnedByReplay(cwd);
  return cwd;
}

// The Mac Bash tool shell has the command text in no process argument, so `pkill -f <text>` must not find the replay's own shell: a shell reads the text from a file and evals it.
function getInterpreterArguments(run: ScriptRun, code: string): string[] {
  if (isPythonCtxExecuteRun(run)) {
    return ["-c", code];
  }
  const scriptFolder = mkdtempSync(join(tmpdir(), "engine-v3-script-"));
  const scriptFile = join(scriptFolder, "script.txt");
  writeFileSync(scriptFile, code);
  recordReplayOwnFile(scriptFolder);
  recordReplayOwnFile(scriptFile);
  return ["-c", `eval "$(cat ${scriptFile})"`];
}

function sleepMilliseconds(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function getBackgroundOutputPath(result: BashCallResult): string {
  const outputPath = /Output is being written to: (\S+)\./.exec(result.resultText)?.[1];
  if (outputPath === undefined) {
    throw new Error(`getBackgroundOutputPath: the recorded result names no output file\nresult: ${result.resultText}`);
  }
  return outputPath;
}

// Claude Code makes the session scratchpad folder at session start, so a command that names it finds it there.
function createScratchpadFoldersNamedByCommand(command: string): void {
  for (const match of command.matchAll(/\/private\/tmp\/claude-\d+\/[^/\s]+\/[0-9a-f-]{36}\/scratchpad/g)) {
    createFolderOwnedByReplay(match[0]);
  }
}

// A run_in_background command (a dev server) never exits, so it starts detached and the replay waits only for its first output line.
// Claude Code writes the output to the recorded path and ends it with "\n[exited with code N]"; the wrapper shell writes that line.
function startBackgroundCommand(run: ScriptRun, cwd: string, env: NodeJS.ProcessEnv, result: BashCallResult): void {
  const outputFile = getBackgroundOutputPath(result);
  createFolderOwnedByReplay(dirname(outputFile));
  const outputDescriptor = openSync(outputFile, "w");
  recordReplayOwnFile(outputFile);
  const wrapperScript = `"$@"; printf '\\n[exited with code %s]' "$?"`;
  const child = spawn("sh", ["-c", wrapperScript, "sh", getInterpreter(run), ...getInterpreterArguments(run, run.code)], { cwd, env, detached: true, stdio: ["ignore", outputDescriptor, outputDescriptor] });
  child.unref();
  const deadlineMs = Date.now() + BACKGROUND_FIRST_OUTPUT_TIMEOUT_MILLISECONDS;
  while (statSync(outputFile).size === 0) {
    if (Date.now() > deadlineMs) {
      throw new Error(`startBackgroundCommand: no output within ${BACKGROUND_FIRST_OUTPUT_TIMEOUT_MILLISECONDS} ms\ncommand: ${run.code}`);
    }
    sleepMilliseconds(100);
  }
}

// Returns the exit mismatch when the replayed exit code differs from the record: the caller decides once the event's file changes are known.
// A recorded hook command such as `node ~/.claude/hooks/turn-done.ts` reads CLAUDE_CODE_SESSION_ID; a line with no sessionId leaves it unset (spawnSync drops undefined values).
function executeScriptCommand(state: Path, run: ScriptRun, result: BashCallResult, line: JSONLLine, context: ScriptReplayContext): ExitMismatch | undefined {
  const cwd = getScriptCwd(run);
  const gitEnv = getGitEnvForOptionalRepo(run.code, result, context.sourceRepo);
  const recordedAtEpochSeconds = Math.floor(run.timestamp.getTime() / 1000);
  const uuidEnv = getRecordedUuidEnv(context.newOutputUuids?.get(result.toolUseId.toString()));
  // const env = { ...process.env, ...CLAUDE_CODE_ENV, HOME: MAC_HOME_FOLDER, ...gitEnv, REPLAY_RECORDED_AT_EPOCH_SECONDS: String(recordedAtEpochSeconds) };
  const env = { ...process.env, ...CLAUDE_CODE_ENV, HOME: MAC_HOME_FOLDER, CLAUDE_CODE_SESSION_ID: getSessionId(line)?.toString(), ...gitEnv, ...uuidEnv, REPLAY_RECORDED_AT_EPOCH_SECONDS: String(recordedAtEpochSeconds) };
  createScratchpadFoldersNamedByCommand(run.code);
  if (run.runInBackground === true) {
    startBackgroundCommand(run, cwd, env, result);
    return undefined;
  }
  // const spawned = spawnSync("bash", ["-c", run.code], { cwd, timeout: SCRIPT_TIMEOUT_MILLISECONDS, encoding: "utf8", maxBuffer: SCRIPT_MAX_BUFFER_BYTES, env });
  // const spawned = spawnSync(getInterpreter(run), getInterpreterArguments(run, replaceDebtReportCall(run.code)), { cwd, timeout: SCRIPT_TIMEOUT_MILLISECONDS, encoding: "utf8", maxBuffer: SCRIPT_MAX_BUFFER_BYTES, env });
  // The Mac Bash tool gives the command no stdin; a piped stdin makes `rg` with no path search stdin instead of the folder.
  const timeout = context.scriptTimeoutMilliseconds ?? SCRIPT_TIMEOUT_MILLISECONDS;
  const runStartChangeTime = readRunStartChangeTime();
  const spawned = spawnSync(getInterpreter(run), getInterpreterArguments(run, replaceDebtReportCall(run.code)), { cwd, timeout, encoding: "utf8", maxBuffer: SCRIPT_MAX_BUFFER_BYTES, env, stdio: ["ignore", "pipe", "pipe"] });
  let exitMismatchError: Error | undefined = undefined;
  if (isFailureOfRecordedSuccessThatChangedNoProjectFile(spawned, result.isError, state, runStartChangeTime)) {
    recordContinuedFailure(getRunSourceText(run));
    console.log(`${new Date().toISOString()} note: failed, changed no project file: ${getRunSourceText(run)} exit ${spawned.status ?? spawned.signal}: ${getFirstStderrLine(spawned)}`);
  } else {
    exitMismatchError = findExitMismatchError(spawned, run, cwd, result.isError);
  }
  assertHeadMatchesLogInOptionalRepo(run.code, result, context.sourceRepo, state, spawned);
  if (exitMismatchError === undefined) {
    return undefined;
  }
  if (!result.isError) {
    // The Mac call succeeded, so if the settle step ignores this mismatch the call may have changed files on the Mac: the backup rules must not cover for it.
    recordContinuedFailure(getRunSourceText(run));
  }
  return { error: exitMismatchError, source: getRecordSource(line)!, toolUseId: run.toolUseId!.toString(), recordedIsError: result.isError, replayedExitCode: spawned.status! };
}

function executeScriptRun(state: Path, run: ScriptRun, line: JSONLLine, context: ScriptReplayContext): ExitMismatch | undefined {
  const toolUseId = run.toolUseId as Uuid;
  const result = context.bashCallResults.get(toolUseId.toString());
  if (result === undefined) {
    throw new Error(`executeScriptRun: no recorded result for Bash call ${toolUseId.toString()}\ncommand: ${run.code}`);
  }
  if (isNeverRanResult(result)) {
    replayBlockedTestRun(run, result);
    return undefined;
  }
  if (isMacOnlyCommand(run.code)) {
    fillMacOnlyFiles(state, toolUseId, getRequiredSourceRepo(context.sourceRepo));
    return undefined;
  }
  const isMacOnlyScript = isMacOnlyScriptRun(run);
  if (isMacOnlyScript) {
    fillMacOnlyFiles(state, toolUseId, getRequiredSourceRepo(context.sourceRepo));
    return undefined;
  }
  if (!isPythonCtxExecuteRun(run)) {
    // if (isReadOnlyInternetCommand(run.code)) {
    //   return;
    // }
    // if (isReadOnlyMacStateCommand(run.code)) {
    //   return;
    // }
    // The user's rule: only calls that change a file matter.
    if (isReadOnlyCommand(run.code)) {
      console.log(`${new Date().toISOString()} note: skipped, changes no file: ${getRunSourceText(run)}`);
      return undefined;
    }
    // The user's rule: a browser test makes the app server run `claude -p`, which the container cannot do.
    const heredocFiles = new Map<string, string>();
    if (isBrowserTestWithNoProjectWrite(run.code, getRunCwd(run), readScriptTextFromDisk, heredocFiles)) {
      writeHeredocFiles(heredocFiles);
      console.log(`${new Date().toISOString()} note: skipped, browser test writes no project file: ${getRunSourceText(run)}`);
      return undefined;
    }
    // The image has Chromium at the Chrome program path, so a call that runs a Chrome script file runs for real.
    // if (isMacOnlyScriptCommand(run.code, getRunCwd(run))) {
    //   return;
    // }
  }
  fillMissingBunLockfileFromOptionalRepo(state, run, context.sourceRepo);
  createLinkedWorktreeWhenCommandNamesIt(state, run.code, PLAYGROUND_TEST_WORKTREE);
  return executeScriptCommand(state, run, result, line, context);
}

// Returns the exit mismatches of its runs: the caller settles them once the event's file changes are known.
export function executeScriptInState(state: Path, line: JSONLLine, context: ScriptReplayContext): ExitMismatch[] {
  const runs = findScriptRun(line);
  if (runs === undefined) {
    throw new Error("executeScriptInState: the line holds no Bash call");
  }
  if (context.outsideGitFolders !== undefined) {
    if (!(line.timestamp instanceof Date)) {
      throw new Error("executeScriptInState: a Bash line with outside git folders needs a timestamp");
    }
    fillOutsideGitFoldersAtTime(context.outsideGitFolders, OUTSIDE_LIVE_ROOT, line.timestamp);
  }
  const exitMismatches: ExitMismatch[] = [];
  for (const run of runs) {
    const exitMismatch = executeScriptRun(state, run, line, context);
    if (exitMismatch !== undefined) {
      exitMismatches.push(exitMismatch);
    }
  }
  return exitMismatches;
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

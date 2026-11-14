// On the Mac the block-npm-test hook refused a test command and ran the tests in the background; later commands read its log. This runs the same hook so those logs exist under their recorded names.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
const HOOK_FOLDER = "/Users/matkatmusicllc/Programming/dotfiles/claude/claude_hooks/block-npm-test";
const BLOCKED_TEXT = "Test runners are blocked.";
const LOG_PATH_LINE = /^Then read the log: (\S+)$/gm;
const WAIT_FOR_DONE_SECONDS = "600";
const HOOK_SETTINGS = {
  CLAUDE_HOOKS_BLOCK_NPM_TEST_KILL_AFTER_SECONDS: "3600",
  CLAUDE_HOOKS_BLOCK_NPM_TEST_TEST_TIMEOUT_MS: "120000",
  CLAUDE_HOOKS_BLOCK_NPM_TEST_LOG_MAX_AGE_MS: "604800000",
};
function findLogPaths(text: string): string[] {
  const logPaths: string[] = [];
  for (const match of text.matchAll(LOG_PATH_LINE)) {
    logPaths.push(match[1] as string);
  }
  return logPaths;
}
function runHookAndFindLogPaths(run: ScriptRun, logFolder: string): string[] {
  if (run.cwd === undefined) {
    throw new Error(`runHookAndFindLogPaths: the Bash call has no cwd\ncommand: ${run.code}`);
  }
  const settings = { ...HOOK_SETTINGS, CLAUDE_HOOKS_BLOCK_NPM_TEST_LOG_DIR: logFolder };
  const hookInput = { cwd: run.cwd.toString(), tool_input: { command: run.code }, settings };
  const hook = spawnSync("node", [join(HOOK_FOLDER, "block-npm-test.ts")], { input: JSON.stringify(hookInput), encoding: "utf8" });
  if (hook.status !== 0) {
    throw new Error(`runHookAndFindLogPaths: the hook failed with status ${hook.status}\nstderr: ${hook.stderr}\ncommand: ${run.code}`);
  }
  const hookOutput = JSON.parse(hook.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } };
  return findLogPaths(hookOutput.hookSpecificOutput.permissionDecisionReason);
}
function waitForDoneFile(logPath: string): void {
  spawnSync("node", [join(HOOK_FOLDER, "monitor-test-run.ts"), logPath, WAIT_FOR_DONE_SECONDS], { encoding: "utf8" });
  if (!existsSync(`${logPath}.done`)) {
    throw new Error(`waitForDoneFile: the test run did not finish within ${WAIT_FOR_DONE_SECONDS} seconds: ${logPath}`);
  }
}
export function replayBlockedTestRun(run: ScriptRun, result: BashCallResult): void {
  if (!result.resultText.includes(BLOCKED_TEXT)) {
    return;
  }
  const recordedLogs = findLogPaths(result.resultText);
  if (recordedLogs.length === 0) {
    throw new Error(`replayBlockedTestRun: the blocked result names no log\nresult: ${result.resultText}`);
  }
  const actualLogs = runHookAndFindLogPaths(run, dirname(recordedLogs[0] as string));
  if (actualLogs.length !== recordedLogs.length) {
    throw new Error(`replayBlockedTestRun: the hook made ${actualLogs.length} logs but the record names ${recordedLogs.length}\ncommand: ${run.code}`);
  }
  for (const [index, recordedLog] of recordedLogs.entries()) {
    const actualLog = actualLogs[index] as string;
    waitForDoneFile(actualLog);
    copyFileSync(actualLog, recordedLog);
    copyFileSync(`${actualLog}.done`, `${recordedLog}.done`);
  }
}

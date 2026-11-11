import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { replayBlockedTestRun } from "./engineV3_replay_blocked_test_run.ts";
const RECORDED_LOG_NAME = "1793122549168-0.log";
function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function makeBlockedResult(project: string, recordedLog: string, testFile: string): BashCallResult {
  const resultText = `PreToolUse:Bash hook error: Test runners are blocked. bun test ${testFile} runs in the background in ${project}.\nRun this command with a Bash timeout of 300000 to be notified when the test run is finished:\nnode /x/monitor-test-run.ts ${recordedLog}\nThen read the log: ${recordedLog}`;
  return { toolUseId: new Uuid("toolu_01BlockedTestRun"), startMs: 0, endMs: 1, isError: true, resultText, command: "" };
}
test("test_replayBlockedTestRun_makes_the_recorded_log_and_done_files_by_running_the_hook", (t) => {
  // Scenario: on the Mac the block-npm-test hook ran the tests in the background and wrote a log under the recorded name; a later command reads that log.
  // the project has a package.json and one passing test file
  const project = makeTempFolder(t, "engine-v3-blocked-project-");
  writeFileSync(join(project, "package.json"), "{}");
  writeFileSync(join(project, "sample.test.ts"), 'import { test } from "bun:test";\ntest("ok", () => {});\n');
  // the recorded result names a log in a log folder
  const logFolder = makeTempFolder(t, "engine-v3-blocked-logs-");
  mkdirSync(logFolder, { recursive: true });
  const recordedLog = join(logFolder, RECORDED_LOG_NAME);
  const result = makeBlockedResult(project, recordedLog, "sample.test.ts");
  const run: ScriptRun = { code: "bun test sample.test.ts", cwd: new Path(project), timestamp: new Date("2026-10-27T17:35:49.168Z") };
  // replay the blocked call
  replayBlockedTestRun(run, result);
  // the done file exists under the recorded name
  assert.equal(existsSync(`${recordedLog}.done`), true);
  // the log under the recorded name holds the passing test summary
  assert.match(readFileSync(recordedLog, "utf8"), /1 pass/);
});

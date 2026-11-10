import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState, type ScriptReplayContext } from "./engineV3_replay_script.ts";
import { MAC_ONLY_FILLS, fillMacOnlyFile, fillMacOnlyFiles, isMacOnlyCommand } from "./engineV3_replay_script_skip.ts";

const CHROME_PROGRAM = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("test_isMacOnlyCommand_is_true_when_the_command_runs_sips", () => {
  // Scenario: sips exists only on the Mac.
  // a command that crops a picture with sips
  const command = "S=/tmp/x; sips --cropOffset 0 0 --cropToHeightWidth 10 10 a.png --out b.png";
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_false_when_sips_is_inside_another_word", () => {
  // Scenario: the word rule needs a whole word.
  // a command that reads a file called gossips.txt
  const command = "cat gossips.txt";
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

test("test_isMacOnlyCommand_is_true_when_the_command_starts_the_chrome_program", () => {
  // Scenario: the Chrome program path in quotes is a Chrome run.
  // a command that starts headless Chrome
  const command = `"${CHROME_PROGRAM}" --headless=new --remote-debugging-port=47312`;
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_true_when_a_variable_holds_the_chrome_program", () => {
  // Scenario: a C="..." variable still names the Chrome program.
  // a command that stores the program path in C and runs it
  const command = `C="${CHROME_PROGRAM}"; "$C" --headless=new`;
  // the command is Mac only
  assert.equal(isMacOnlyCommand(command), true);
});

test("test_isMacOnlyCommand_is_false_when_the_command_only_lists_the_chrome_folder", () => {
  // Scenario: a listing of the Chrome folder does not run Chrome.
  // a command that lists the folder
  const command = 'ls "/Applications/Google Chrome.app/Contents/MacOS/" 2>/dev/null';
  // the command is not Mac only
  assert.equal(isMacOnlyCommand(command), false);
});

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

// A repo whose one commit holds docs/report.png with the given bytes; returns the git folder and the commit.
function makeRepoWithReport(t: TestContext, bytes: Buffer): { gitFolder: Path; commit: string } {
  const repo = makeTempFolder(t, "engine-v3-skip-repo-");
  mkdirSync(join(repo, "docs"));
  writeFileSync(join(repo, "docs", "report.png"), bytes);
  const gitArguments = ["-c", "user.name=T", "-c", "user.email=t@t"];
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", [...gitArguments, "commit", "-q", "-m", "report"], { cwd: repo });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  return { gitFolder: new Path(join(repo, ".git")), commit };
}

test("test_fillMacOnlyFile_writes_the_bytes_of_the_commit_file_into_the_state", (t) => {
  // Scenario: the stand-in file has the same bytes as the file in the source repo commit.
  // the source repo has a commit with docs/report.png
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const source = makeRepoWithReport(t, bytes);
  // the state folder is empty
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // fill the file from that commit
  fillMacOnlyFile(state, { toolUseId: new Uuid("toolu_x"), repoPath: new Path("docs/report.png"), commit: source.commit }, source.gitFolder);
  // the state folder has the same bytes
  assert.deepEqual(readFileSync(join(state.toString(), "docs", "report.png")), bytes);
});

test("test_fillMacOnlyFiles_writes_nothing_for_a_call_without_a_fill", (t) => {
  // Scenario: only the one named call gets a stand-in file.
  // the state folder is empty and the source repo does not exist
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // fill for another call id
  fillMacOnlyFiles(state, new Uuid("toolu_other"), new Path("/nonexistent"));
  // the state folder has no docs folder
  assert.throws(() => readFileSync(join(state.toString(), "docs", "report.png")), /ENOENT/);
});

// Loads one Bash call line with the given id and command, and builds a context whose recorded result is isError false.
function loadCallAndContext(t: TestContext, command: string, resultText: string, isError: boolean, cwd: string): { line: JSONLLine; context: ScriptReplayContext } {
  const block = { type: "tool_use", id: "toolu_01Skip", name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-skip-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  const result = { toolUseId: new Uuid("toolu_01Skip"), startMs: 0, endMs: 1, isError, resultText };
  return { line: loadTranscript(jsonlFile).records[0] as JSONLLine, context: { bashCallResults: new Map([["toolu_01Skip", result]]), writeEditResultLines: new Map(), sourceRepo: new Path("/nonexistent") } };
}

test("test_executeScriptInState_skips_a_call_that_never_ran", (t) => {
  // Scenario: a call blocked by a hook never ran, so the replay does not run it.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call writes ran.txt and its recorded result is a hook error
  const { line, context } = loadCallAndContext(t, "echo ran > ran.txt", "PreToolUse:Bash hook error: no", true, state.toString());
  // run the line
  executeScriptInState(state, line, context);
  // ran.txt is not in the state folder
  assert.equal(existsSync(join(state.toString(), "ran.txt")), false);
});

test("test_executeScriptInState_skips_a_Mac_only_call", (t) => {
  // Scenario: a call that runs sips does not run in the container.
  // the state folder is the record's cwd
  const state = new Path(makeTempFolder(t, "engine-v3-skip-state-"));
  // the call writes ran.txt after a sips run
  const { line, context } = loadCallAndContext(t, "sips --version; echo ran > ran.txt", "", false, state.toString());
  // run the line
  executeScriptInState(state, line, context);
  // ran.txt is not in the state folder
  assert.equal(existsSync(join(state.toString(), "ran.txt")), false);
});

test("test_MAC_ONLY_FILLS_names_the_report_png_call_and_its_commit", () => {
  // Scenario: the one skipped call that copied docs/report.png gets that file back from commit 9becb03.
  // the fill list has one entry
  assert.equal(MAC_ONLY_FILLS.length, 1);
  // the entry names the call, the repo path and the commit
  const fill = MAC_ONLY_FILLS[0]!;
  assert.equal(fill.toolUseId.toString(), "toolu_01MCSxEwsbVK6FgSQZMCN8Jp");
  assert.equal(fill.repoPath.toString(), "docs/report.png");
  assert.equal(fill.commit, "9becb03");
});

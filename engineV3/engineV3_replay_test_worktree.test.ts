import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import { executeScriptInState } from "./engineV3_replay_script.ts";
import { createLinkedWorktreeWhenCommandNamesIt, type LinkedWorktree } from "./engineV3_replay_test_worktree.ts";

const TOOL_USE_ID = "toolu_01TestWorktreeCall";
const IDENTITY_ENV = { GIT_AUTHOR_NAME: "Ann", GIT_AUTHOR_EMAIL: "ann@a.test", GIT_COMMITTER_NAME: "Cy", GIT_COMMITTER_EMAIL: "cy@c.test" };

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function runGit(folder: string, args: string[]): string {
  return execFileSync("git", args, { cwd: folder, env: { ...process.env, ...IDENTITY_ENV }, encoding: "utf8" }).trim();
}

// A state repo with one commit, and a worktree description that points at a folder next to it.
function makeScenario(t: TestContext): { state: Path; worktree: LinkedWorktree } {
  const stateFolder = join(makeTempFolder(t, "engine-v3-test-worktree-"), "state");
  runGit(makeTempFolder(t, "engine-v3-test-worktree-parent-"), ["init", "-q", stateFolder]);
  writeFileSync(join(stateFolder, "file.txt"), "one\n");
  runGit(stateFolder, ["add", "."]);
  runGit(stateFolder, ["commit", "-q", "-m", "one"]);
  const commit = runGit(stateFolder, ["rev-parse", "HEAD"]);
  const worktreePath = new Path(join(makeTempFolder(t, "engine-v3-test-worktree-linked-"), "typesafe-playground-test"));
  return { state: new Path(stateFolder), worktree: { path: worktreePath, commit, ignoredFolder: "playground/results" } };
}

test("test_createLinkedWorktreeWhenCommandNamesIt_makes_a_detached_worktree_at_the_commit", (t) => {
  // Scenario: the first recorded command that names the worktree finds it already made.
  const scenario = makeScenario(t);
  // a command names the worktree folder
  createLinkedWorktreeWhenCommandNamesIt(scenario.state, `ls ${scenario.worktree.path.toString()}/playground`, scenario.worktree);
  // the worktree HEAD is the commit and HEAD is detached
  assert.equal(runGit(scenario.worktree.path.toString(), ["rev-parse", "HEAD"]), scenario.worktree.commit);
  assert.equal(runGit(scenario.worktree.path.toString(), ["branch", "--show-current"]), "");
});

test("test_createLinkedWorktreeWhenCommandNamesIt_makes_the_ignored_folder_the_user_run_filled", (t) => {
  // Scenario: the Mac worktree had playground/results (the user ran the playground there), so `ls` of it exits 0.
  const scenario = makeScenario(t);
  // a command names the worktree folder
  createLinkedWorktreeWhenCommandNamesIt(scenario.state, `ls ${scenario.worktree.path.toString()}/playground/results`, scenario.worktree);
  // the ignored folder exists in the worktree
  assert.equal(existsSync(join(scenario.worktree.path.toString(), "playground", "results")), true);
});

test("test_createLinkedWorktreeWhenCommandNamesIt_makes_nothing_when_the_command_does_not_name_the_worktree", (t) => {
  // Scenario: an ordinary command leaves the Mac folder layout alone.
  const scenario = makeScenario(t);
  // a command that names another folder
  createLinkedWorktreeWhenCommandNamesIt(scenario.state, "ls playground/results", scenario.worktree);
  // no worktree folder exists
  assert.equal(existsSync(scenario.worktree.path.toString()), false);
});

test("test_createLinkedWorktreeWhenCommandNamesIt_leaves_an_existing_worktree_alone", (t) => {
  // Scenario: the second command that names the worktree must not make it again.
  const scenario = makeScenario(t);
  // two commands name the worktree: the second call does not throw
  createLinkedWorktreeWhenCommandNamesIt(scenario.state, `git -C ${scenario.worktree.path.toString()} status`, scenario.worktree);
  assert.doesNotThrow(() => createLinkedWorktreeWhenCommandNamesIt(scenario.state, `git -C ${scenario.worktree.path.toString()} status`, scenario.worktree));
});

test("test_createLinkedWorktreeWhenCommandNamesIt_lets_a_recorded_worktree_remove_succeed", (t) => {
  // Scenario: the recorded `git worktree remove` of the test worktree needs the worktree to exist.
  const scenario = makeScenario(t);
  // the command removes the worktree
  const command = `git worktree remove ${scenario.worktree.path.toString()}`;
  createLinkedWorktreeWhenCommandNamesIt(scenario.state, command, scenario.worktree);
  // the real remove runs and the folder is gone
  runGit(scenario.state.toString(), ["worktree", "remove", scenario.worktree.path.toString()]);
  assert.equal(existsSync(scenario.worktree.path.toString()), false);
});

test("test_executeScriptInState_makes_the_typesafe_playground_test_worktree_before_a_command_that_names_it", (t) => {
  // Scenario: executeScriptRun calls the worktree maker; the state has no 85c2c39, so the maker's git worktree add stops the run (nothing is made on this machine).
  const scenario = makeScenario(t);
  const command = "ls /Users/matkatmusicllc/Programming/typesafe-playground-test/playground/results";
  const block = { type: "tool_use", id: TOOL_USE_ID, name: "Bash", input: { command, description: "test" }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd: scenario.state.toString(), timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(makeTempFolder(t, "engine-v3-test-worktree-jsonl-"), "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  const line = loadTranscript(jsonlFile).records[0] as JSONLLine;
  const result = { toolUseId: new Uuid(TOOL_USE_ID), startMs: 0, endMs: 1, isError: false, resultText: "" };
  const context = { bashCallResults: new Map([[TOOL_USE_ID, result]]), writeEditResultLines: new Map(), sourceRepo: undefined };
  // the run stops in the worktree maker, not in the command
  assert.throws(() => executeScriptInState(scenario.state, line, context), /git worktree add .*85c2c39/);
});

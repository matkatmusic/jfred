import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { assertHeadMatchesLog } from "./engineV3_replay_script_git_env.ts";

const FIRST_SECONDS = 1700000000;
const SECOND_SECONDS = 1700000100;
const THIRD_SECONDS = 1700000500;
const NO_OUTPUT = { stdout: "", stderr: "" };

type Scenario = { sourceRepo: Path; sourceWorktree: string; state: Path; stateWorktree: string; firstCommit: string; secondCommit: string };

function makeFolder(t: TestContext): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "engine-v3-git-worktree-")));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

const IDENTITY_ENV = { GIT_AUTHOR_NAME: "Ann", GIT_AUTHOR_EMAIL: "ann@a.test", GIT_COMMITTER_NAME: "Cy", GIT_COMMITTER_EMAIL: "cy@c.test" };

function runGit(folder: string, args: string[], dateEnv: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: folder, env: { ...process.env, ...IDENTITY_ENV, ...dateEnv }, encoding: "utf8" }).trim();
}

function makeCommitAt(folder: string, seconds: number): string {
  const dateText = `${seconds} +0000`;
  const dateEnv = { GIT_AUTHOR_DATE: dateText, GIT_COMMITTER_DATE: dateText };
  writeFileSync(join(folder, "file.txt"), `${seconds}\n`);
  runGit(folder, ["add", "."], dateEnv);
  runGit(folder, ["commit", "-q", "-m", `at ${seconds}`], dateEnv);
  return runGit(folder, ["rev-parse", "HEAD"]);
}

function makeResultAround(seconds: number): BashCallResult {
  return { toolUseId: new Uuid("toolu_x"), startMs: (seconds - 0.5) * 1000, endMs: (seconds + 0.5) * 1000, isError: false, resultText: "", command: "" };
}

// The source repo has a main commit at SECOND_SECONDS (another agent) and a linked worktree "check"; the state clone sits at the first commit and has its own "check" worktree.
function makeScenario(t: TestContext): Scenario {
  const sourceFolder = join(makeFolder(t), "source");
  mkdirSync(sourceFolder);
  runGit(sourceFolder, ["init", "-q"]);
  const firstCommit = makeCommitAt(sourceFolder, FIRST_SECONDS);
  const sourceWorktree = join(makeFolder(t), "check");
  runGit(sourceFolder, ["worktree", "add", "-q", "--detach", sourceWorktree, firstCommit]);
  const secondCommit = makeCommitAt(sourceFolder, SECOND_SECONDS);
  const stateFolder = join(makeFolder(t), "state");
  runGit(makeFolder(t), ["clone", "-q", sourceFolder, stateFolder]);
  runGit(stateFolder, ["reset", "-q", "--hard", firstCommit]);
  const stateWorktree = join(makeFolder(t), "check");
  runGit(stateFolder, ["worktree", "add", "-q", "--detach", stateWorktree, firstCommit]);
  return { sourceRepo: new Path(join(sourceFolder, ".git")), sourceWorktree, state: new Path(stateFolder), stateWorktree, firstCommit, secondCommit };
}

test("test_assertHeadMatchesLog_ignores_main_log_rows_for_a_command_run_in_a_linked_worktree", (t) => {
  // Scenario: another agent committed in the main folder during a command that ran in the linked worktree.
  const scenario = makeScenario(t);
  // the command works in the linked worktree, whose own log has no row in the window of the main commit
  const command = `cd ${scenario.stateWorktree} && git checkout --detach ${scenario.firstCommit}`;
  // the main log row at SECOND_SECONDS is not this command's row, so the check does not throw
  assert.doesNotThrow(() => assertHeadMatchesLog(command, makeResultAround(SECOND_SECONDS), scenario.sourceRepo, scenario.state, NO_OUTPUT));
});

test("test_assertHeadMatchesLog_throws_when_the_linked_worktree_head_differs_from_its_own_log", (t) => {
  // Scenario: the linked worktree log says the command committed W, but the replayed worktree HEAD is still the first commit.
  const scenario = makeScenario(t);
  // the source worktree commits W at THIRD_SECONDS, which writes a row in the worktree's own log
  const worktreeCommit = makeCommitAt(scenario.sourceWorktree, THIRD_SECONDS);
  const command = `cd ${scenario.stateWorktree} && git commit -m x`;
  // the error names W as expected and the first commit as actual
  assert.throws(() => assertHeadMatchesLog(command, makeResultAround(THIRD_SECONDS), scenario.sourceRepo, scenario.state, NO_OUTPUT), (error: Error) => {
    assert.match(error.message, new RegExp(`left HEAD at ${scenario.firstCommit} but the log says ${worktreeCommit}`));
    return true;
  });
});

test("test_assertHeadMatchesLog_passes_when_the_linked_worktree_head_is_the_last_row_of_its_own_log", (t) => {
  // Scenario: the replayed worktree HEAD equals the worktree log's commit.
  const scenario = makeScenario(t);
  // the source worktree commits W at THIRD_SECONDS and the state worktree moves to W
  const worktreeCommit = makeCommitAt(scenario.sourceWorktree, THIRD_SECONDS);
  runGit(scenario.stateWorktree, ["fetch", "-q", "--no-tags", scenario.sourceRepo.toString(), worktreeCommit]);
  runGit(scenario.stateWorktree, ["checkout", "-q", "--detach", worktreeCommit]);
  const command = `cd ${scenario.stateWorktree} && git commit -m x`;
  // the check does not throw
  assert.doesNotThrow(() => assertHeadMatchesLog(command, makeResultAround(THIRD_SECONDS), scenario.sourceRepo, scenario.state, NO_OUTPUT));
});

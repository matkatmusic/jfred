import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import type { JSONLLine } from "./engineV3.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { executeScriptInState } from "./engineV3_replay_script.ts";
import { assertHeadMatchesLog, getGitEnvForCall } from "./engineV3_replay_script_git_env.ts";

const FIRST_SECONDS = 1700000000;
const SECOND_SECONDS = 1700000100;
const THIRD_SECONDS = 1700000500;
const NO_OUTPUT = { stdout: "", stderr: "" };

type TempRepo = { repo: string; sourceRepo: Path };

function makeTempRepo(t: TestContext): TempRepo {
  const repo = mkdtempSync(join(tmpdir(), "engine-v3-git-env-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return { repo, sourceRepo: new Path(join(repo, ".git")) };
}

function makeCommitAt(repo: string, seconds: number, authorName: string): void {
  const dateText = `${seconds} +0000`;
  const env = { ...process.env, GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: `${authorName}@a.test`, GIT_AUTHOR_DATE: dateText, GIT_COMMITTER_NAME: "Cy", GIT_COMMITTER_EMAIL: "cy@c.test", GIT_COMMITTER_DATE: dateText };
  writeFileSync(join(repo, "file.txt"), `${seconds}\n`);
  execFileSync("git", ["add", "."], { cwd: repo, env });
  execFileSync("git", ["commit", "-q", "-m", `at ${seconds}`], { cwd: repo, env });
}

function makeResultAround(seconds: number): BashCallResult {
  return { toolUseId: new Uuid("toolu_x"), startMs: (seconds - 0.5) * 1000, endMs: (seconds + 0.5) * 1000, isError: false, resultText: "" };
}

function readHead(repo: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

test("test_getGitEnvForCall_returns_nothing_for_a_command_without_git", (t) => {
  // Scenario: only git commands get the commit identity.
  // a repo with a commit inside the window
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  // the command has no git in it
  const env = getGitEnvForCall("echo hi", makeResultAround(FIRST_SECONDS), sourceRepo);
  // no variables
  assert.deepEqual(env, {});
});

test("test_getGitEnvForCall_returns_author_and_committer_of_the_commit_made_in_the_window", (t) => {
  // Scenario: the replay commit gets the same names and times as the recorded commit.
  // a repo with a commit made at FIRST_SECONDS
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  // the call window holds that second
  const env = getGitEnvForCall("git commit -m x", makeResultAround(FIRST_SECONDS), sourceRepo);
  // the six variables come from that commit
  const dateText = `${FIRST_SECONDS} +0000`;
  assert.deepEqual(env, { GIT_AUTHOR_NAME: "Ann", GIT_AUTHOR_EMAIL: "Ann@a.test", GIT_AUTHOR_DATE: dateText, GIT_COMMITTER_NAME: "Cy", GIT_COMMITTER_EMAIL: "cy@c.test", GIT_COMMITTER_DATE: dateText });
});

test("test_getGitEnvForCall_returns_the_last_commit_made_in_the_window", (t) => {
  // Scenario: two commits in one window: the later one wins.
  // a repo with two commits one second apart
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  makeCommitAt(repo, FIRST_SECONDS + 1, "Bob");
  // the call window holds both seconds
  const env = getGitEnvForCall("git commit -m x", makeResultAround(FIRST_SECONDS + 0.5), sourceRepo);
  // the author is the second commit's author
  assert.equal(env.GIT_AUTHOR_NAME, "Bob");
});

test("test_getGitEnvForCall_returns_nothing_when_no_log_row_is_in_the_window", (t) => {
  // Scenario: a git call that moved nothing keeps the default identity.
  // a repo with a commit far from the window
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  // the call window is later
  const env = getGitEnvForCall("git status", makeResultAround(THIRD_SECONDS), sourceRepo);
  // no variables
  assert.deepEqual(env, {});
});

test("test_getGitEnvForCall_ignores_a_log_row_whose_commit_was_made_before_the_window", (t) => {
  // Scenario: a checkout of an old commit is a log row but not a commit made by the call.
  // a repo with two commits, then a checkout of the first one at THIRD_SECONDS
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  makeCommitAt(repo, SECOND_SECONDS, "Bob");
  const dateText = `${THIRD_SECONDS} +0000`;
  execFileSync("git", ["checkout", "-q", "--detach", "HEAD~1"], { cwd: repo, env: { ...process.env, GIT_COMMITTER_DATE: dateText } });
  // the call window holds THIRD_SECONDS
  const env = getGitEnvForCall("git checkout --detach HEAD~1", makeResultAround(THIRD_SECONDS), sourceRepo);
  // no variables
  assert.deepEqual(env, {});
});

test("test_assertHeadMatchesLog_passes_when_head_is_the_last_row_commit_of_the_window", (t) => {
  // Scenario: the replay HEAD equals the recorded HEAD.
  // a repo whose last commit is at SECOND_SECONDS
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  makeCommitAt(repo, SECOND_SECONDS, "Bob");
  // the check does not throw
  assert.doesNotThrow(() => assertHeadMatchesLog("git commit -m x", makeResultAround(SECOND_SECONDS), sourceRepo, new Path(repo), NO_OUTPUT));
});

test("test_assertHeadMatchesLog_throws_with_command_expected_and_actual_hash_when_head_differs", (t) => {
  // Scenario: a replay HEAD that is not the recorded commit stops the replay.
  // a repo with two commits; the window holds only the first
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  const firstCommit = readHead(repo);
  makeCommitAt(repo, SECOND_SECONDS, "Bob");
  const secondCommit = readHead(repo);
  // the error names the command, the expected hash and the actual hash
  assert.throws(() => assertHeadMatchesLog("git commit -m x", makeResultAround(FIRST_SECONDS), sourceRepo, new Path(repo), NO_OUTPUT), (error: Error) => {
    assert.match(error.message, /git commit -m x/);
    assert.match(error.message, new RegExp(firstCommit));
    assert.match(error.message, new RegExp(secondCommit));
    return true;
  });
});

test("test_assertHeadMatchesLog_names_the_file_that_differs_when_head_differs", (t) => {
  // Scenario: the stop message shows which file made the hashes differ.
  // a repo with two commits that change file.txt; the window holds only the first
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  makeCommitAt(repo, SECOND_SECONDS, "Bob");
  // the error lists file.txt as modified between the expected commit and HEAD
  assert.throws(() => assertHeadMatchesLog("git commit -m x", makeResultAround(FIRST_SECONDS), sourceRepo, new Path(repo), NO_OUTPUT), (error: Error) => {
    assert.match(error.message, /M\s+file\.txt/);
    return true;
  });
});

test("test_assertHeadMatchesLog_shows_the_tail_of_stdout_and_stderr_when_head_differs", (t) => {
  // Scenario: the stop message carries what the command printed.
  // a repo with two commits; the window holds only the first
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  makeCommitAt(repo, SECOND_SECONDS, "Bob");
  // the command printed a long stdout and a short stderr
  const output = { stdout: `START-MARK${"x".repeat(5000)}END-MARK`, stderr: "STDERR-MARK" };
  // the error has the end of stdout and the stderr, but not the start of stdout
  assert.throws(() => assertHeadMatchesLog("git commit -m x", makeResultAround(FIRST_SECONDS), sourceRepo, new Path(repo), output), (error: Error) => {
    assert.match(error.message, /END-MARK/);
    assert.match(error.message, /STDERR-MARK/);
    assert.doesNotMatch(error.message, /START-MARK/);
    return true;
  });
});

test("test_assertHeadMatchesLog_passes_when_the_window_has_no_row", (t) => {
  // Scenario: no log row in the window means nothing to compare.
  // a repo with commits far from the window
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  // the check does not throw
  assert.doesNotThrow(() => assertHeadMatchesLog("git status", makeResultAround(THIRD_SECONDS), sourceRepo, new Path(repo), NO_OUTPUT));
});

test("test_executeScriptInState_replays_a_git_commit_to_the_same_hash_as_the_source", (t) => {
  // Scenario: with the recorded names and times, a replayed git commit gets the recorded hash.
  // the source repo has a base commit and an empty commit "x" made at SECOND_SECONDS
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  const env = { ...process.env, GIT_AUTHOR_NAME: "Bob", GIT_AUTHOR_EMAIL: "Bob@a.test", GIT_AUTHOR_DATE: `${SECOND_SECONDS} +0000`, GIT_COMMITTER_NAME: "Cy", GIT_COMMITTER_EMAIL: "cy@c.test", GIT_COMMITTER_DATE: `${SECOND_SECONDS} +0000` };
  execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "x"], { cwd: repo, env });
  const sourceHash = readHead(repo);
  // the state folder is a clone reset to the base commit
  const stateFolder = join(repo, "..", `${repo.split("/").pop()}-state`);
  execFileSync("git", ["clone", "-q", repo, stateFolder]);
  t.after(() => rmSync(stateFolder, { recursive: true, force: true }));
  execFileSync("git", ["reset", "-q", "--hard", "HEAD~1"], { cwd: stateFolder });
  // the recorded call is the same commit command
  const block = { type: "tool_use", id: "toolu_x", name: "Bash", input: { command: "git commit -q --allow-empty -m x", description: "test" }, caller: { type: "direct" } };
  const callLine = { type: "assistant", uuid: "4b836cc7-2357-412e-9f53-b23191b3c68a", parentUuid: null, cwd: stateFolder, timestamp: "2026-10-27T17:24:20.837Z", sessionId: "7d31cfda-fb91-4f61-ba61-7031cb5484e2", message: { role: "assistant", content: [block] } };
  const jsonlFile = join(repo, "session.jsonl");
  writeFileSync(jsonlFile, JSON.stringify(callLine) + "\n");
  const line = loadTranscript(jsonlFile).records[0] as JSONLLine;
  // replay the line
  executeScriptInState(new Path(stateFolder), line, { bashCallResults: new Map([["toolu_x", makeResultAround(SECOND_SECONDS)]]), writeEditResultLines: new Map(), sourceRepo });
  // the state HEAD is the source hash
  assert.equal(readHead(stateFolder), sourceHash);
});

test("test_assertHeadMatchesLog_passes_for_a_command_without_git", (t) => {
  // Scenario: only git commands get the check.
  // a repo whose HEAD differs from the window row
  const { repo, sourceRepo } = makeTempRepo(t);
  makeCommitAt(repo, FIRST_SECONDS, "Ann");
  makeCommitAt(repo, SECOND_SECONDS, "Bob");
  // the check does not throw
  assert.doesNotThrow(() => assertHeadMatchesLog("echo hi", makeResultAround(FIRST_SECONDS), sourceRepo, new Path(repo), NO_OUTPUT));
});

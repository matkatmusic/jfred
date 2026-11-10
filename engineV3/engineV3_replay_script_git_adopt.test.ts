import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import type { BashCallResult } from "./engineV3_replay_bash_results.ts";
import { assertHeadMatchesLog } from "./engineV3_replay_script_git_env.ts";

const COMMIT_SECONDS = 1700000000;
const LATE_COMMITTER_SECONDS = 1700000005;
const NO_OUTPUT = { stdout: "", stderr: "" };

function makeRepoWithCommit(t: TestContext, fileText: string, committerSeconds: number): string {
  const repo = mkdtempSync(join(tmpdir(), "engine-v3-git-adopt-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const env = { ...process.env, GIT_AUTHOR_NAME: "Ann", GIT_AUTHOR_EMAIL: "ann@a.test", GIT_AUTHOR_DATE: `${COMMIT_SECONDS} +0000`, GIT_COMMITTER_NAME: "Cy", GIT_COMMITTER_EMAIL: "cy@c.test", GIT_COMMITTER_DATE: `${committerSeconds} +0000` };
  writeFileSync(join(repo, "file.txt"), fileText);
  execFileSync("git", ["add", "."], { cwd: repo, env });
  execFileSync("git", ["commit", "-q", "-m", "m"], { cwd: repo, env });
  return repo;
}

function makeResultAroundCommit(): BashCallResult {
  return { toolUseId: new Uuid("toolu_x"), startMs: (COMMIT_SECONDS - 0.5) * 1000, endMs: (COMMIT_SECONDS + 0.5) * 1000, isError: false, resultText: "" };
}

function readHead(repo: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

function runAssertHeadMatchesLog(sourceRepo: string, stateRepo: string): void {
  assertHeadMatchesLog("git commit -m x", makeResultAroundCommit(), new Path(join(sourceRepo, ".git")), new Path(stateRepo), NO_OUTPUT);
}

test("test_assertHeadMatchesLog_adopts_the_real_commit_when_only_the_committer_date_differs", (t) => {
  // Scenario: same files, different hash: HEAD moves to the real commit and the branch follows.
  // the source repo and the state repo hold the same file but the committer seconds differ
  const sourceRepo = makeRepoWithCommit(t, "same\n", COMMIT_SECONDS);
  const stateRepo = makeRepoWithCommit(t, "same\n", LATE_COMMITTER_SECONDS);
  const realHash = readHead(sourceRepo);
  assert.notEqual(readHead(stateRepo), realHash);
  const branchName = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: stateRepo, encoding: "utf8" }).trim();
  // the check does not throw
  assert.doesNotThrow(() => runAssertHeadMatchesLog(sourceRepo, stateRepo));
  // HEAD is the real hash and the branch points at it
  assert.equal(readHead(stateRepo), realHash);
  assert.equal(execFileSync("git", ["rev-parse", branchName], { cwd: stateRepo, encoding: "utf8" }).trim(), realHash);
  // the work tree file is unchanged and git sees no changes
  assert.equal(readFileSync(join(stateRepo, "file.txt"), "utf8"), "same\n");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: stateRepo, encoding: "utf8" }), "");
});

test("test_assertHeadMatchesLog_adopts_the_real_commit_and_stays_detached_when_head_is_detached", (t) => {
  // Scenario: same files, different hash, detached HEAD: HEAD moves and stays detached.
  const sourceRepo = makeRepoWithCommit(t, "same\n", COMMIT_SECONDS);
  const stateRepo = makeRepoWithCommit(t, "same\n", LATE_COMMITTER_SECONDS);
  const realHash = readHead(sourceRepo);
  execFileSync("git", ["checkout", "-q", "--detach"], { cwd: stateRepo });
  // the check does not throw
  assert.doesNotThrow(() => runAssertHeadMatchesLog(sourceRepo, stateRepo));
  // HEAD is the real hash and is still detached
  assert.equal(readHead(stateRepo), realHash);
  assert.notEqual(spawnSync("git", ["symbolic-ref", "-q", "HEAD"], { cwd: stateRepo }).status, 0);
});

test("test_assertHeadMatchesLog_still_throws_when_a_file_differs", (t) => {
  // Scenario: different files stop the replay and HEAD stays where it was.
  const sourceRepo = makeRepoWithCommit(t, "real\n", COMMIT_SECONDS);
  const stateRepo = makeRepoWithCommit(t, "other\n", LATE_COMMITTER_SECONDS);
  const replayHash = readHead(stateRepo);
  // the check throws and HEAD is unchanged
  assert.throws(() => runAssertHeadMatchesLog(sourceRepo, stateRepo), /assertHeadMatchesLog/);
  assert.equal(readHead(stateRepo), replayHash);
});

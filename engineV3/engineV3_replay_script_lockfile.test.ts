import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { fillMissingBunLockfile } from "./engineV3_replay_script_lockfile.ts";

const FIRST_COMMIT_SECONDS = 1700000000;
const SECOND_COMMIT_SECONDS = 1700000100;
const THIRD_COMMIT_SECONDS = 1700000200;

function makeTempFolder(t: TestContext, prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function commitFile(repo: string, relativePath: string, content: string, committerSeconds: number): void {
  const file = join(repo, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  const date = `${committerSeconds} +0000`;
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  execFileSync("git", ["add", "."], { cwd: repo });
  execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-q", "-m", content], { cwd: repo, env });
}

// A repo with playground/bun.lock committed at each given time; the content is "lock-<seconds>".
function makeRepoWithLockfiles(t: TestContext, committerSeconds: number[]): Path {
  const repo = makeTempFolder(t, "engine-v3-lockfile-repo-");
  execFileSync("git", ["init", "-q"], { cwd: repo });
  for (const seconds of committerSeconds) {
    commitFile(repo, "playground/bun.lock", `lock-${seconds}`, seconds);
  }
  return new Path(join(repo, ".git"));
}

function makeRun(code: string, cwd: string, runSeconds: number): ScriptRun {
  return { code, cwd: new Path(cwd), timestamp: new Date(runSeconds * 1000) };
}

test("test_fillMissingBunLockfile_writes_the_bun_lock_when_it_is_missing", (t) => {
  // Scenario: a bun install with no bun.lock gets the lockfile of the next commit.
  const sourceRepo = makeRepoWithLockfiles(t, [SECOND_COMMIT_SECONDS]);
  const state = new Path(makeTempFolder(t, "engine-v3-lockfile-state-"));
  // the run installs in playground, before that commit
  fillMissingBunLockfile(state, makeRun("bun install 2>&1 | tail -3", join(state.toString(), "playground"), FIRST_COMMIT_SECONDS), sourceRepo);
  // the state folder has the lockfile of that commit
  assert.equal(readFileSync(join(state.toString(), "playground", "bun.lock"), "utf8"), `lock-${SECOND_COMMIT_SECONDS}`);
});

test("test_fillMissingBunLockfile_keeps_the_bun_lock_that_exists", (t) => {
  // Scenario: an existing bun.lock stays as it is.
  const sourceRepo = makeRepoWithLockfiles(t, [SECOND_COMMIT_SECONDS]);
  const state = new Path(makeTempFolder(t, "engine-v3-lockfile-state-"));
  mkdirSync(join(state.toString(), "playground"));
  writeFileSync(join(state.toString(), "playground", "bun.lock"), "mine");
  // the run installs in playground
  fillMissingBunLockfile(state, makeRun("bun install", join(state.toString(), "playground"), FIRST_COMMIT_SECONDS), sourceRepo);
  // the file still holds the old text
  assert.equal(readFileSync(join(state.toString(), "playground", "bun.lock"), "utf8"), "mine");
});

test("test_fillMissingBunLockfile_does_nothing_for_a_command_without_bun_install", (t) => {
  // Scenario: a command that does not run bun install writes no file.
  const sourceRepo = makeRepoWithLockfiles(t, [SECOND_COMMIT_SECONDS]);
  const state = new Path(makeTempFolder(t, "engine-v3-lockfile-state-"));
  // the run lists a folder
  fillMissingBunLockfile(state, makeRun("ls", join(state.toString(), "playground"), FIRST_COMMIT_SECONDS), sourceRepo);
  // the state folder has no lockfile
  assert.equal(existsSync(join(state.toString(), "playground", "bun.lock")), false);
});

test("test_fillMissingBunLockfile_picks_the_first_commit_at_or_after_the_run_time", (t) => {
  // Scenario: three commits hold three lockfiles; the run time is between the first and the second.
  const sourceRepo = makeRepoWithLockfiles(t, [FIRST_COMMIT_SECONDS, SECOND_COMMIT_SECONDS, THIRD_COMMIT_SECONDS]);
  const state = new Path(makeTempFolder(t, "engine-v3-lockfile-state-"));
  fillMissingBunLockfile(state, makeRun("bun install", join(state.toString(), "playground"), FIRST_COMMIT_SECONDS + 50), sourceRepo);
  // the lockfile is from the second commit
  assert.equal(readFileSync(join(state.toString(), "playground", "bun.lock"), "utf8"), `lock-${SECOND_COMMIT_SECONDS}`);
});

test("test_fillMissingBunLockfile_uses_the_folder_of_the_cd_before_bun_install", (t) => {
  // Scenario: cd playground && bun install, run from the state folder, installs in playground.
  const sourceRepo = makeRepoWithLockfiles(t, [SECOND_COMMIT_SECONDS]);
  const state = new Path(makeTempFolder(t, "engine-v3-lockfile-state-"));
  fillMissingBunLockfile(state, makeRun("cd playground && bun install 2>&1 | tail -3", state.toString(), FIRST_COMMIT_SECONDS), sourceRepo);
  // the lockfile lands in playground
  assert.equal(readFileSync(join(state.toString(), "playground", "bun.lock"), "utf8"), `lock-${SECOND_COMMIT_SECONDS}`);
});

test("test_fillMissingBunLockfile_throws_when_no_commit_is_at_or_after_the_run_time", (t) => {
  // Scenario: the only commit is older than the run, so no lockfile fits.
  const sourceRepo = makeRepoWithLockfiles(t, [FIRST_COMMIT_SECONDS]);
  const state = new Path(makeTempFolder(t, "engine-v3-lockfile-state-"));
  const run = makeRun("bun install", join(state.toString(), "playground"), SECOND_COMMIT_SECONDS);
  assert.throws(() => fillMissingBunLockfile(state, run, sourceRepo), /no commit at or after/);
});

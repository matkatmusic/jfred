// Layer 1 view: a pair with no created node carries the reason it was dropped.  Called in-process over a real temp repo whose folder is also the project folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLayer1View } from "../src/viewer_api_layer1.ts";
import { Path } from "../src/structures/domain.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";

const FIRST_COMMIT_DATE = "2020-01-01T10:00:00Z";
const LATER_MTIME = new Date("2030-01-01T10:00:00Z");

// A repo with one file committed in 2020, so the file's birth (now) is later than its first commit.
function makeRepoWithFileBornAfterItsFirstCommit(): string {
  const root = mkdtempSync(join(tmpdir(), "layer1-created-"));
  writeFileSync(join(root, "a.txt"), "a\n");
  const env = { ...process.env, GIT_COMMITTER_DATE: FIRST_COMMIT_DATE, GIT_AUTHOR_DATE: FIRST_COMMIT_DATE };
  for (const command of ["init -q", "add -A", "commit -q -m one"]) {
    execSync(`git -c user.name=t -c user.email=t@t ${command}`, { cwd: root, stdio: "pipe", env });
  }
  utimesSync(join(root, "a.txt"), LATER_MTIME, LATER_MTIME);
  return root;
}

test("test_buildLayer1View_marks_a_birth_after_the_first_commit_as_not_trusted", () => {
  // Scenario: birth (now) is earlier than the 2030 mtime but later than the 2020 first commit: no created node, reason birthAfterFirstCommit.
  const root = makeRepoWithFileBornAfterItsFirstCommit();
  const view = buildLayer1View(new Path(root), new Path(root), "HEAD");
  const pair = view.pairs.find((candidate) => candidate.path.toString() === "a.txt");
  assert.equal(pair?.created, undefined);
  assert.equal(pair?.createdNotTrusted, CreatedNotTrustedReason.birthAfterFirstCommit);
});

test("test_buildLayer1View_marks_a_birth_not_before_the_mtime_as_not_trusted", () => {
  // Scenario: the mtime is set to 2001 and the birth is later, so the disk walk drops the birth: reason birthNotBeforeMtime.
  const root = makeRepoWithFileBornAfterItsFirstCommit();
  const old = new Date("2001-01-01T00:00:00Z");
  utimesSync(join(root, "a.txt"), old, old);
  const view = buildLayer1View(new Path(root), new Path(root), "HEAD");
  const pair = view.pairs.find((candidate) => candidate.path.toString() === "a.txt");
  assert.equal(pair?.created, undefined);
  assert.equal(pair?.createdNotTrusted, CreatedNotTrustedReason.birthNotBeforeMtime);
});

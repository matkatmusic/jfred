import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCandidates, readSweepSettings } from "../scripts/per_file_sweep_settings.ts";

test("test_readSweepSettings_reads_flags_and_falls_back_to_defaults", () => {
  const settings = readSweepSettings(["--repo", "/r", "--status", "A", "--limit", "3"]);

  assert.equal(settings.repo.toString(), "/r");
  assert.equal(settings.status, "A");
  assert.equal(settings.limit, 3);
  assert.equal(settings.baseCommit, "793e65241902f276caf5f5c28d539269e7d36d11");
});

test("test_listCandidates_honours_the_limit", () => {
  const repo = mkdtempSync(join(tmpdir(), "sweep-settings-"));
  mkdirSync(repo, { recursive: true });
  const runGit = (args: string[]): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  runGit(["init", "--quiet"]);
  runGit(["config", "user.email", "a@example.test"]);
  runGit(["config", "user.name", "A"]);
  writeFileSync(join(repo, "a.txt"), "1\n");
  writeFileSync(join(repo, "b.txt"), "1\n");
  runGit(["add", "."]);
  runGit(["commit", "--quiet", "-m", "base"]);
  const base = runGit(["rev-parse", "HEAD"]).trim();
  writeFileSync(join(repo, "a.txt"), "2\n");
  writeFileSync(join(repo, "b.txt"), "2\n");

  const all = listCandidates(readSweepSettings(["--repo", repo, "--base-commit", base]));
  const limited = listCandidates(readSweepSettings(["--repo", repo, "--base-commit", base, "--limit", "1"]));

  assert.deepEqual(all.map((file) => file.toString()), ["a.txt", "b.txt"]);
  assert.deepEqual(limited.map((file) => file.toString()), ["a.txt"]);
});

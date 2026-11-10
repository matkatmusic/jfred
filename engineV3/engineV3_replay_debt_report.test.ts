import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { replaceDebtReportCall } from "./engineV3_replay_debt_report.ts";

const DEBT_REPORT_SCRIPT = "/Users/matkatmusicllc/Programming/dotfiles/claude/claude_hooks/debt-ratchet/debt-ratchet-report.ts";
const FOUR_SPACE_SOURCE = "export function getOne(): number {\n    const one = 1;\n    return one;\n}\n";
const CSS_SOURCE = "body {\n    color: red;\n}\n";

function makeRepoWithUnformattedFiles(t: TestContext): string {
  const repo = mkdtempSync(join(tmpdir(), "engine-v3-debt-report-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  writeFileSync(join(repo, "one.ts"), FOUR_SPACE_SOURCE);
  writeFileSync(join(repo, "page.css"), CSS_SOURCE);
  execFileSync("git", ["add", "."], { cwd: repo });
  return repo;
}

function readTrackedFiles(repo: string): string[] {
  return [readFileSync(join(repo, "one.ts"), "utf8"), readFileSync(join(repo, "page.css"), "utf8")];
}

test("test_replaceDebtReportCall_replaces_the_report_script_with_the_fix_script", () => {
  // Scenario: a recorded command that runs the report between two git calls keeps those calls.
  // the command names the report by its full path
  const command = `git status; node ${DEBT_REPORT_SCRIPT}; git log --oneline -2`;
  // the replaced command runs the fix script with tsx and keeps the rest
  const replaced = replaceDebtReportCall(command);
  assert.match(replaced, /^git status; node '[^']+engineV3_debt_report_fix\.ts'; git log --oneline -2$/);
});

test("test_replaceDebtReportCall_replaces_the_report_named_through_a_variable", () => {
  // Scenario: the recorded command wrote the hooks folder as $H.
  // the command names the report as $H/debt-ratchet/debt-ratchet-report.ts
  const replaced = replaceDebtReportCall("node $H/debt-ratchet/debt-ratchet-report.ts 2>&1 | tail -5");
  // the report is replaced and the pipe stays
  assert.match(replaced, /^node '[^']+engineV3_debt_report_fix\.ts' 2>&1 \| tail -5$/);
});

test("test_replaceDebtReportCall_leaves_other_commands_alone", () => {
  // Scenario: a command that does not run the report is not changed.
  // the command only reads the report script
  const command = "rg -n eslint debt-ratchet-report.ts";
  // the same text comes back
  assert.equal(replaceDebtReportCall(command), command);
});

test("test_fix_script_leaves_the_same_files_as_the_debt_report", (t) => {
  // Scenario: the report's only effect on disk is eslint --fix on each tracked file, and the fix script has the same effect in one eslint run.
  // two repos hold the same unformatted tracked files
  const reportRepo = makeRepoWithUnformattedFiles(t);
  const fixRepo = mkdtempSync(join(tmpdir(), "engine-v3-debt-fix-"));
  t.after(() => rmSync(fixRepo, { recursive: true, force: true }));
  cpSync(reportRepo, fixRepo, { recursive: true });
  const before = readTrackedFiles(reportRepo);
  // the original report runs in the first repo
  execFileSync("node", [DEBT_REPORT_SCRIPT], { cwd: reportRepo, encoding: "utf8" });
  // the replaced command runs in the second repo
  const replaced = replaceDebtReportCall(`node ${DEBT_REPORT_SCRIPT}`);
  execFileSync("sh", ["-c", replaced], { cwd: fixRepo, encoding: "utf8" });
  // the report changed a file, and both repos hold the same bytes
  const afterReport = readTrackedFiles(reportRepo);
  assert.notDeepEqual(afterReport, before);
  assert.deepEqual(readTrackedFiles(fixRepo), afterReport);
});

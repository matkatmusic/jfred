import { test } from "node:test";
import assert from "node:assert/strict";
import * as patterns from "../src/regex_expressions.ts";

test("test_bash_commands_capture_their_paths", () => {
  assert.deepEqual(patterns.bashRemoveCommand.exec("rm a.py b.py")!.slice(1), ["a.py b.py"]);
  assert.deepEqual(patterns.bashMoveCommand.exec("git mv old.py new.py")!.slice(1), ["old.py", "new.py"]);
  assert.deepEqual(patterns.bashCopyCommand.exec("cp a.py b.py")!.slice(1), ["a.py", "b.py"]);
  assert.equal(patterns.bashAppendRedirect.exec("echo hi >> log.txt")![1], "log.txt");
  assert.equal(patterns.bashOverwriteRedirect.exec("echo hi > out.txt")![1], "out.txt");
  assert.equal(patterns.bashOverwriteRedirect.exec("echo hi >> out.txt"), null);
  assert.equal(patterns.bashOverwriteRedirect.exec("echo hi >&2"), null);
});

test("test_simple_patterns_match_expected_text", () => {
  assert.ok(patterns.numbersOnly.test("12"));
  assert.ok(!patterns.numbersOnly.test("12a"));
  assert.equal("toolu_01AB".replace(patterns.toolUseIdPrefix, ""), "01AB");
  assert.equal("3\tdef hello()".replace(patterns.lineNumberPrefix, ""), "def hello()");
  assert.deepEqual(patterns.numberedLine.exec("12\tdef hello()")!.slice(1), ["12", "def hello()"]);
  assert.equal(patterns.numberedLine.exec("..."), null);
  assert.equal("a  b\t\nc".replace(patterns.whitespaceRuns, " "), "a b c");
  assert.deepEqual("a\n@@ x\nb\n@@ y".split(patterns.beforeDiffHunkHeader), ["a\n", "@@ x\nb\n", "@@ y"]);
  assert.equal("branch rewound, branch rewound".match(patterns.branchRewoundHeader)!.length, 2);
  assert.equal("rewound rewound".match(patterns.rewoundMention)!.length, 2);
  assert.deepEqual('x "billing.py" "renames.csv"'.match(patterns.quotedFilename), ['"billing.py"', '"renames.csv"']);
});

test("test_ledger_row_captures_id_and_last_cell", () => {
  const match = patterns.ledgerRow.exec("| s19 | PASS | 4/4 | 2026-06-25T20:41:00.000Z |")!;
  assert.deepEqual(match.slice(1), ["s19", "2026-06-25T20:41:00.000Z"]);
});

test("test_git_patterns_capture_expected_groups", () => {
  assert.equal(patterns.gitCommitCommand.exec('git -C /tmp/repo commit -m "x"')![1], "/tmp/repo");
  assert.equal(patterns.gitCommitCommand.exec('git commit -m "x"')![1], undefined);
  assert.equal(patterns.gitCommitCommand.exec("git commitx"), null);
  assert.equal(patterns.gitCommitResultHashLine.exec("[master (root-commit) ab12cd3] init")![1], "ab12cd3");
  assert.equal(patterns.bareCommitHashToken.exec("ok 928eaa9")![1], "928eaa9");
  assert.ok(patterns.gitCommandStart.test("git init"));
  assert.ok(!patterns.gitCommandStart.test("github-cli sync"));
  assert.deepEqual(patterns.gitAddCommand.exec("git -C /r add a.py")!.slice(1), ["/r", " a.py"]);
  assert.deepEqual('git commit -m "post rename"'.match(patterns.shellCommandToken), ["git", "commit", "-m", '"post rename"']);
});

test("test_rename_and_move_patterns_need_literal_filenames", () => {
  assert.deepEqual([..."one.py -> core_one.py".matchAll(patterns.renameArrowLine)][0]!.slice(1), ["one.py", "core_one.py"]);
  assert.equal("f_one -> alpha".match(patterns.renameArrowLine), null);
  assert.equal("{name}.py -> core_{name}.py".match(patterns.renameArrowLine), null);
  const call = [...'shutil.move("a.py", "b.py")'.matchAll(patterns.codeLiteralMoveCall)][0]!;
  assert.deepEqual(call.slice(1), ["a.py", "b.py"]);
  assert.equal("shutil.move(src, dst)".match(patterns.codeLiteralMoveCall), null);
});

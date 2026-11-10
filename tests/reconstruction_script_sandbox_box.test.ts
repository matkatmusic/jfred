import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import {
    buildSandboxBox,
    computeSandboxBoxKey,
    executeInRealBox,
    resolveRunBox,
} from "../src/reconstruction_script_sandbox_box.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const COMMIT_DATE = "2026-01-01T00:00:00Z";
const BEFORE_COMMIT = new Date("2025-12-31T00:00:00Z");
const AFTER_COMMIT = new Date("2026-01-05T00:00:00Z");

function runTestGit(cwd: string, args: string[], date?: string): string {
    const env = date === undefined ? GIT_ENV : { ...GIT_ENV, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date };
    const configured = ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args];
    return execFileSync("git", configured, { cwd, env, encoding: "utf8" }).trim();
}

interface TestRepo {
    root: string;
    commit: string;
}

function createTestRepo(): TestRepo {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "reveng-box-test-")));
    runTestGit(root, ["init", "-q", "-b", "main"]);
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "a.txt"), "a\n");
    runTestGit(root, ["add", "."]);
    runTestGit(root, ["commit", "-q", "-m", "first"], COMMIT_DATE);
    return { root, commit: runTestGit(root, ["rev-parse", "HEAD"]) };
}

function makeRun(overrides: Partial<ScriptRun>): ScriptRun {
    return { code: "print(1)", timestamp: AFTER_COMMIT, ...overrides };
}

test("test_buildSandboxBox_inline_run_uses_script_file_in_the_cwd", () => {
    // Scenario: an inline run with a cwd and no repo runs `<cwd>/__script__.py` with no project.
    const box = buildSandboxBox(makeRun({ cwd: new Path("/Users/me/proj") }), undefined);
    assert.equal(box.scriptPath.toString(), "/Users/me/proj/__script__.py");
    assert.equal(box.workdir.toString(), "/Users/me/proj");
    assert.equal(box.root.toString(), "/Users/me/proj");
    assert.equal(box.project, undefined);
    assert.equal(box.stdoutRedirect, undefined);
});

test("test_buildSandboxBox_run_without_cwd_or_repo_uses_work", () => {
    // Scenario: no cwd and no repo puts the box at /work.
    const box = buildSandboxBox(makeRun({}), undefined);
    assert.equal(box.root.toString(), "/work");
    assert.equal(box.workdir.toString(), "/work");
    assert.equal(box.scriptPath.toString(), "/work/__script__.py");
});

test("test_buildSandboxBox_named_relative_script_resolves_against_the_cwd", () => {
    // Scenario: `audit/x.py` typed in cwd `/Users/me/proj` runs `/Users/me/proj/audit/x.py`.
    const run = makeRun({ cwd: new Path("/Users/me/proj"), invokedScriptPath: "audit/x.py" });
    assert.equal(buildSandboxBox(run, undefined).scriptPath.toString(), "/Users/me/proj/audit/x.py");
});

test("test_buildSandboxBox_tilde_script_resolves_against_the_home_folder", () => {
    // Scenario: `~/tools/x.py` runs the absolute path under os.homedir().
    const run = makeRun({ cwd: new Path("/Users/me/proj"), invokedScriptPath: "~/tools/x.py" });
    assert.equal(buildSandboxBox(run, undefined).scriptPath.toString(), join(homedir(), "tools/x.py"));
});

test("test_buildSandboxBox_absolute_script_inside_the_root_keeps_its_path", () => {
    // Scenario: an absolute script path under the repo root is the script path.
    const repo = createTestRepo();
    const scriptPath = join(repo.root, "audit", "x.py");
    const run = makeRun({ cwd: new Path(repo.root), invokedScriptPath: scriptPath });
    const box = buildSandboxBox(run, new Path(repo.root));
    assert.equal(box.scriptPath.toString(), scriptPath);
    assert.equal(box.root.toString(), repo.root);
});

test("test_buildSandboxBox_absolute_script_outside_the_root_keeps_its_path", () => {
    // Scenario: `/tmp/repro2.py` is the script path even though it is outside the root.
    const run = makeRun({ cwd: new Path("/Users/me/proj"), invokedScriptPath: "/tmp/repro2.py" });
    const box = buildSandboxBox(run, undefined);
    assert.equal(box.scriptPath.toString(), "/tmp/repro2.py");
    assert.equal(box.root.toString(), "/Users/me/proj");
});

test("test_buildSandboxBox_cwd_in_a_repo_subfolder_makes_the_repo_root_the_box_root", () => {
    // Scenario: cwd `<repo>/sub` gives root `<repo>`, workdir `<repo>/sub`, and the project at the commit.
    const repo = createTestRepo();
    const box = buildSandboxBox(makeRun({ cwd: new Path(join(repo.root, "sub")) }), new Path(repo.root));
    assert.equal(box.root.toString(), repo.root);
    assert.equal(box.workdir.toString(), join(repo.root, "sub"));
    assert.equal(box.project?.repo.toString(), repo.root);
    assert.equal(box.project?.commit.toString(), repo.commit);
});

test("test_buildSandboxBox_cwd_outside_the_repo_makes_the_cwd_the_box_root", () => {
    // Scenario: a cwd in another worktree is the root; the project is still the repo commit.
    const repo = createTestRepo();
    const box = buildSandboxBox(makeRun({ cwd: new Path("/Users/me/other-worktree") }), new Path(repo.root));
    assert.equal(box.root.toString(), "/Users/me/other-worktree");
    assert.equal(box.workdir.toString(), "/Users/me/other-worktree");
    assert.equal(box.project?.commit.toString(), repo.commit);
});

// Replaced by test_buildSandboxBox_throws_for_a_repo_path_in_no_repo.
// test("test_buildSandboxBox_folder_without_git_has_no_project", () => {
//     // Scenario: a repo path with no `.git` gives no project.
//     const folder = realpathSync(mkdtempSync(join(tmpdir(), "reveng-box-nogit-")));
//     const box = buildSandboxBox(makeRun({ cwd: new Path(folder) }), new Path(folder));
//     assert.equal(box.project, undefined);
//     assert.equal(box.root.toString(), folder);
// });

test("test_buildSandboxBox_uses_the_repo_top_folder_for_a_subfolder_path", () => {
    // Scenario: a subfolder repo path gives the repo top folder as box root and project repo.
    const repo = createTestRepo();
    const box = buildSandboxBox(makeRun({}), new Path(join(repo.root, "sub")));
    assert.equal(box.root.toString(), repo.root);
    assert.equal(box.project?.repo.toString(), repo.root);
    assert.equal(box.project?.commit.toString(), repo.commit);
});

test("test_buildSandboxBox_throws_for_a_repo_path_in_no_repo", () => {
    // Scenario: a repo path with no git repository above it throws and names the folder.
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "reveng-box-norepo-")));
    assert.throws(() => buildSandboxBox(makeRun({}), new Path(folder)), new RegExp(`repo folder ${folder} is not inside a git repository`));
});

test("test_buildSandboxBox_run_before_the_first_commit_has_no_project", () => {
    // Scenario: no commit before the run gives no project.
    const repo = createTestRepo();
    const box = buildSandboxBox(makeRun({ cwd: new Path(repo.root), timestamp: BEFORE_COMMIT }), new Path(repo.root));
    assert.equal(box.project, undefined);
});

test("test_buildSandboxBox_passes_the_stdout_redirect_from_the_command", () => {
    // Scenario: `... > out.md 2> err.txt` gives the stdout target `out.md`, not appending.
    const run = makeRun({ cwd: new Path("/Users/me/proj"), invokedScriptPath: "x.py", invokedCommand: "python3 x.py > out.md 2> err.txt" });
    const redirect = buildSandboxBox(run, undefined).stdoutRedirect;
    assert.equal(redirect?.target.toString(), "out.md");
    assert.equal(redirect?.appends, false);
});

test("test_buildSandboxBox_throws_on_a_colon_in_the_cwd", () => {
    // Scenario: a colon in the root or workdir throws.
    assert.throws(() => buildSandboxBox(makeRun({ cwd: new Path("/Users/me/a:b") }), undefined), /colon/);
});

test("test_buildSandboxBox_throws_on_a_colon_in_an_outside_script_path", () => {
    // Scenario: a colon in a script path outside the root throws.
    const run = makeRun({ cwd: new Path("/Users/me/proj"), invokedScriptPath: "/tmp/a:b.py" });
    assert.throws(() => buildSandboxBox(run, undefined), /colon/);
});

test("test_computeSandboxBoxKey_is_stable_and_holds_the_commit", () => {
    // Scenario: equal boxes give equal text; a different commit changes the text.
    const repo = createTestRepo();
    const run = makeRun({ cwd: new Path(repo.root) });
    const first = buildSandboxBox(run, new Path(repo.root));
    const second = buildSandboxBox(run, new Path(repo.root));
    assert.equal(computeSandboxBoxKey(first), computeSandboxBoxKey(second));
    assert.ok(computeSandboxBoxKey(first).includes(repo.commit));
    const noProject = buildSandboxBox(run, undefined);
    assert.notEqual(computeSandboxBoxKey(first), computeSandboxBoxKey(noProject));
});

test("test_resolveRunBox_is_undefined_outside_executeInRealBox", () => {
    // Scenario: outside the scope there is no box.
    assert.equal(resolveRunBox(makeRun({ cwd: new Path("/Users/me/proj") })), undefined);
});

test("test_resolveRunBox_returns_the_box_inside_executeInRealBox", () => {
    // Scenario: inside the scope the box has the repo project.
    const repo = createTestRepo();
    const box = executeInRealBox(new Path(repo.root), () => resolveRunBox(makeRun({ cwd: new Path(repo.root) })));
    assert.equal(box?.project?.commit.toString(), repo.commit);
});

test("test_executeInRealBox_restores_the_scope_after_a_throw", () => {
    // Scenario: a throw inside compute still ends the scope.
    const repo = createTestRepo();
    assert.throws(() => executeInRealBox(new Path(repo.root), () => {
        throw new Error("boom");
    }), /boom/);
    assert.equal(resolveRunBox(makeRun({ cwd: new Path(repo.root) })), undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { executeScriptAgainstState } from "../src/reconstruction_script_sandbox.ts";
import { buildSandboxBox } from "../src/reconstruction_script_sandbox_box.ts";
import { SANDBOX_TIMEOUT_MS } from "../src/reconstruction_script_sandbox_dir.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const COMMIT_DATE = "2026-01-01T00:00:00Z";
const AFTER_COMMIT = new Date("2026-01-05T00:00:00Z");
const SETUP_DELAY_MS = 3000;
const TEST_TIMEOUT_MS = 120000;

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
    const root = realpathSync(mkdtempSync(join(tmpdir(), "reveng-box-run-")));
    runTestGit(root, ["init", "-q", "-b", "main"]);
    mkdirSync(join(root, "audit"));
    writeFileSync(join(root, "a.txt"), "committed\n");
    runTestGit(root, ["add", "."]);
    runTestGit(root, ["commit", "-q", "-m", "first"], COMMIT_DATE);
    return { root, commit: runTestGit(root, ["rev-parse", "HEAD"]) };
}

function makeRun(repo: TestRepo, overrides: Partial<ScriptRun>): ScriptRun {
    return { code: "", timestamp: AFTER_COMMIT, cwd: new Path(repo.root), ...overrides };
}

// A unique first line keeps each test out of the memo.
function makeUniqueScript(body: string): string {
    return `# ${randomUUID()}\n${body}`;
}

class SlowStartMap extends Map<string, string> {
    [Symbol.iterator]() {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETUP_DELAY_MS);
        return super[Symbol.iterator]();
    }
}

test("test_box_run_named_relative_script_runs_at_its_real_path", { timeout: TEST_TIMEOUT_MS }, () => {
    // Scenario: `audit/where.py` runs at `<repo>/audit/where.py`, so its parent's parent is the project root.
    const repo = createTestRepo();
    try {
        const run = makeRun(repo, { invokedScriptPath: "audit/where.py" });
        const script = makeUniqueScript('from pathlib import Path\nopen("seen.txt", "w").write(str(Path(__file__).parent.parent))\n');
        const post = executeScriptAgainstState(script, new Map(), "", run.cwd, buildSandboxBox(run, new Path(repo.root)));
        assert.ok(post !== undefined);
        assert.equal(post.get("seen.txt"), repo.root);
    }
    finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
});

test("test_box_run_stdout_redirect_creates_the_target_file", { timeout: TEST_TIMEOUT_MS }, () => {
    // Scenario: `python3 a.py > out.md` puts the printed text in `out.md`.
    const repo = createTestRepo();
    try {
        const run = makeRun(repo, { invokedScriptPath: "a.py", invokedCommand: "python3 a.py > out.md" });
        const script = makeUniqueScript('print("hello")\n');
        const post = executeScriptAgainstState(script, new Map(), "", run.cwd, buildSandboxBox(run, new Path(repo.root)));
        assert.ok(post !== undefined);
        assert.equal(post.get("out.md"), "hello\n");
    }
    finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
});

test("test_box_run_script_file_is_not_in_the_changed_files", { timeout: TEST_TIMEOUT_MS }, () => {
    // Scenario: the script appends to itself and writes a new file; only the new file is reported.
    const repo = createTestRepo();
    try {
        const run = makeRun(repo, { invokedScriptPath: "a.py" });
        const script = makeUniqueScript('open(__file__, "a").write("# more\\n")\nopen("new.txt", "w").write("new\\n")\n');
        const post = executeScriptAgainstState(script, new Map(), "", run.cwd, buildSandboxBox(run, new Path(repo.root)));
        assert.ok(post !== undefined);
        assert.equal(post.get("new.txt"), "new\n");
        assert.equal(post.has("a.py"), false);
    }
    finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
});

test("test_box_run_clone_files_are_present_and_untouched_ones_are_not_reported", { timeout: TEST_TIMEOUT_MS }, () => {
    // Scenario: the script reads a committed file; that file is not reported because it did not change.
    const repo = createTestRepo();
    try {
        const run = makeRun(repo, { invokedScriptPath: "a.py" });
        const script = makeUniqueScript('open("copy.txt", "w").write(open("a.txt").read())\n');
        const post = executeScriptAgainstState(script, new Map(), "", run.cwd, buildSandboxBox(run, new Path(repo.root)));
        assert.ok(post !== undefined);
        assert.equal(post.get("copy.txt"), "committed\n");
        assert.equal(post.has("a.txt"), false);
    }
    finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
});

test("test_box_run_git_in_the_box_reports_the_chosen_commit", { timeout: TEST_TIMEOUT_MS }, () => {
    // Scenario: `git -C . rev-parse HEAD` in the box prints the commit chosen for the run.
    const repo = createTestRepo();
    try {
        const run = makeRun(repo, { invokedScriptPath: "a.py" });
        const script = makeUniqueScript(
            'import subprocess\nresult = subprocess.run(["git", "-C", ".", "rev-parse", "HEAD"], capture_output=True, text=True)\nopen("head.txt", "w").write(result.stdout + result.stderr)\n',
        );
        const post = executeScriptAgainstState(script, new Map(), "", run.cwd, buildSandboxBox(run, new Path(repo.root)));
        assert.ok(post !== undefined);
        assert.equal(post.get("head.txt")?.trim(), repo.commit);
    }
    finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
});

test("test_box_run_timeout_starts_after_setup_ends", { timeout: TEST_TIMEOUT_MS }, () => {
    // Scenario: setup takes 3 seconds; the 5 second limit still counts only from the container start.
    const repo = createTestRepo();
    try {
        const run = makeRun(repo, { invokedScriptPath: "a.py" });
        const script = makeUniqueScript("import time\ntime.sleep(60)\n");
        const startedAt = Date.now();
        const post = executeScriptAgainstState(script, new SlowStartMap(), "", run.cwd, buildSandboxBox(run, new Path(repo.root)));
        const elapsedMs = Date.now() - startedAt;
        assert.equal(post, undefined);
        assert.ok(elapsedMs >= SETUP_DELAY_MS + SANDBOX_TIMEOUT_MS - 500, `ended after ${elapsedMs} ms, before setup plus the limit`);
        assert.ok(elapsedMs < SETUP_DELAY_MS + SANDBOX_TIMEOUT_MS + 8000, `ended after ${elapsedMs} ms, the kill came late`);
    }
    finally {
        rmSync(repo.root, { recursive: true, force: true });
    }
});

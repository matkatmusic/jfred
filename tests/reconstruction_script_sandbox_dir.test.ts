import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    // SANDBOX_TIMEOUT_MS,
    locateReadOnlyScript,
    prepareSandboxDirectory,
    readAllFiles,
    removeSandboxDirectory,
} from "../src/reconstruction_script_sandbox_dir.ts";
import type { SandboxBox } from "../src/reconstruction_script_sandbox_box.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

function makeBox(root: string, workdir: string, scriptPath: string, project?: SandboxBox["project"]): SandboxBox {
    return { root: new Path(root), workdir: new Path(workdir), scriptPath: new Path(scriptPath), stdoutRedirect: undefined, project };
}

function runGit(repoDir: string, args: string[]): string {
    const gitArgs = ["-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=test@test.invalid", ...args];
    return execFileSync("git", gitArgs, { cwd: repoDir, encoding: "utf8" }).trim();
}

function makeRepoWithOneCommit(files: Record<string, string>): { repo: Path; commit: Uuid } {
    const repoDir = mkdtempSync(join(tmpdir(), "reveng-dir-test-repo-"));
    runGit(repoDir, ["init", "--quiet"]);
    for (const [relativePath, content] of Object.entries(files)) {
        mkdirSync(dirname(join(repoDir, relativePath)), { recursive: true });
        writeFileSync(join(repoDir, relativePath), content);
    }
    runGit(repoDir, ["add", "."]);
    runGit(repoDir, ["commit", "--quiet", "-m", "first"]);
    return { repo: new Path(repoDir), commit: new Uuid(runGit(repoDir, ["rev-parse", "HEAD"])) };
}

// not behavior: it only checks that a constant equals 5000.
// test("test_SANDBOX_TIMEOUT_MS_is_five_seconds", () => {
//     assert.equal(SANDBOX_TIMEOUT_MS, 5000);
// });

test("test_prepareSandboxDirectory_seeds_files_and_writes_the_script_unchanged", () => {
    // The recorded cwd text stays in the script: the cwd is now the Docker mount, never swapped.
    const script = 'open("/Users/me/proj/a.txt").read()\n';
    const preState = new Map([["a.txt", "one\n"], ["sub/b.txt", "two\n"]]);
    const tempDir = prepareSandboxDirectory(script, preState);
    try {
        assert.equal(readFileSync(join(tempDir, "a.txt"), "utf8"), "one\n");
        assert.equal(readFileSync(join(tempDir, "sub/b.txt"), "utf8"), "two\n");
        assert.equal(readFileSync(join(tempDir, "__script__.py"), "utf8"), script);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_prepareSandboxDirectory_returns_a_new_directory_each_call", () => {
    const first = prepareSandboxDirectory("pass\n", new Map());
    const second = prepareSandboxDirectory("pass\n", new Map());
    try {
        assert.notEqual(first, second);
        assert.ok(existsSync(first));
    } finally {
        rmSync(first, { recursive: true, force: true });
        rmSync(second, { recursive: true, force: true });
    }
});

test("test_readAllFiles_returns_relative_paths_of_nested_files", () => {
    const tempDir = prepareSandboxDirectory("pass\n", new Map([["x.txt", "1"]]));
    try {
        mkdirSync(join(tempDir, "deep/er"), { recursive: true });
        writeFileSync(join(tempDir, "deep/er/y.txt"), "2");
        const files = Object.fromEntries(readAllFiles(tempDir));
        assert.deepEqual(files, { "__script__.py": "pass\n", "x.txt": "1", "deep/er/y.txt": "2" });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_prepareSandboxDirectory_with_box_writes_start_files_under_the_workdir_and_the_named_script", () => {
    // Scenario: root /proj, workdir /proj/sub, named script /proj/sub/audit/x.py.
    const box = makeBox("/proj", "/proj/sub", "/proj/sub/audit/x.py");
    const preState = new Map([["a.txt", "one\n"], ["deep/b.txt", "two\n"]]);
    const tempDir = prepareSandboxDirectory("print(1)\n", preState, box);
    try {
        // Start files sit at <workdir relative to root>/<key>.
        assert.equal(readFileSync(join(tempDir, "sub/a.txt"), "utf8"), "one\n");
        assert.equal(readFileSync(join(tempDir, "sub/deep/b.txt"), "utf8"), "two\n");
        // The script sits at its named path.
        assert.equal(readFileSync(join(tempDir, "sub/audit/x.py"), "utf8"), "print(1)\n");
        // No script copy at the old fixed name.
        assert.equal(existsSync(join(tempDir, "__script__.py")), false);
    } finally {
        removeSandboxDirectory(tempDir);
    }
});

test("test_prepareSandboxDirectory_with_box_writes_an_inline_script_at_the_workdir_name", () => {
    const box = makeBox("/proj", "/proj", "/proj/__script__.py");
    const tempDir = prepareSandboxDirectory("print(2)\n", new Map(), box);
    try {
        assert.equal(readFileSync(join(tempDir, "__script__.py"), "utf8"), "print(2)\n");
    } finally {
        removeSandboxDirectory(tempDir);
    }
});

test("test_prepareSandboxDirectory_with_project_clones_the_commit_and_start_files_win", () => {
    // Scenario: the commit holds sub/a.txt, sub/b.txt and sub/tool.py; the run has a start file a.txt and writes tool.py.
    const { repo, commit } = makeRepoWithOneCommit({ "sub/a.txt": "committed\n", "sub/b.txt": "kept\n", "sub/tool.py": "old\n" });
    const box = makeBox("/proj", "/proj/sub", "/proj/sub/tool.py", { repo, commit });
    const tempDir = prepareSandboxDirectory("new\n", new Map([["a.txt", "start\n"]]), box);
    try {
        // The clone content is in the temp folder itself.
        assert.ok(existsSync(join(tempDir, ".git")));
        assert.equal(readFileSync(join(tempDir, "sub/b.txt"), "utf8"), "kept\n");
        // A start file wins over the commit.
        assert.equal(readFileSync(join(tempDir, "sub/a.txt"), "utf8"), "start\n");
        // The script wins over the commit file of the same name.
        assert.equal(readFileSync(join(tempDir, "sub/tool.py"), "utf8"), "new\n");
        // The source repo is not the temp folder.
        assert.notEqual(tempDir, repo.toString());
    } finally {
        removeSandboxDirectory(tempDir);
        rmSync(repo.toString(), { recursive: true, force: true });
    }
});

test("test_locateReadOnlyScript_is_undefined_for_a_script_inside_the_root", () => {
    const box = makeBox("/proj", "/proj", "/proj/x.py");
    assert.equal(locateReadOnlyScript("/tmp/reveng-unused", box), undefined);
});

test("test_locateReadOnlyScript_puts_an_outside_script_in_the_script_folder_not_the_temp_folder", () => {
    // Scenario: the run named /tmp/repro2.py, which is outside the root /proj.
    const box = makeBox("/proj", "/proj", "/tmp/repro2.py");
    const tempDir = prepareSandboxDirectory("print(3)\n", new Map(), box);
    try {
        const readOnlyScript = locateReadOnlyScript(tempDir, box)!;
        // The box side file is the typed path.
        assert.equal(readOnlyScript.boxFile.toString(), "/tmp/repro2.py");
        // The host side file holds the script and lives next to the temp folder.
        assert.equal(readFileSync(readOnlyScript.hostFile.toString(), "utf8"), "print(3)\n");
        assert.equal(readOnlyScript.hostFile.toString(), join(`${tempDir}-script`, "repro2.py"));
        // The temp folder has no copy.
        assert.deepEqual(readAllFiles(tempDir), []);
    } finally {
        removeSandboxDirectory(tempDir);
    }
});

test("test_removeSandboxDirectory_removes_the_temp_folder_and_the_script_folder", () => {
    const box = makeBox("/proj", "/proj", "/tmp/repro2.py");
    const tempDir = prepareSandboxDirectory("print(4)\n", new Map(), box);
    assert.ok(existsSync(tempDir));
    assert.ok(existsSync(`${tempDir}-script`));
    removeSandboxDirectory(tempDir);
    assert.equal(existsSync(tempDir), false);
    assert.equal(existsSync(`${tempDir}-script`), false);
});

test("test_removeSandboxDirectory_accepts_a_temp_folder_without_a_script_folder", () => {
    const tempDir = prepareSandboxDirectory("pass\n", new Map());
    removeSandboxDirectory(tempDir);
    assert.equal(existsSync(tempDir), false);
});

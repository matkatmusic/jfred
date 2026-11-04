import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    SANDBOX_TIMEOUT_MS,
    prepareSandboxDirectory,
    readAllFiles,
} from "../src/reconstruction_script_sandbox_dir.ts";

test("test_SANDBOX_TIMEOUT_MS_is_five_seconds", () => {
    assert.equal(SANDBOX_TIMEOUT_MS, 5000);
});

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

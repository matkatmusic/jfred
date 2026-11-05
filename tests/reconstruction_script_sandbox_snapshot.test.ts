import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    applyStdoutRedirect,
    collectBoxPostState,
    snapshotSandboxFiles,
} from "../src/reconstruction_script_sandbox_snapshot.ts";
import type { SandboxBox } from "../src/reconstruction_script_sandbox_box.ts";
import type { ParsedRedirect } from "../src/reconstruction_bash_events.ts";
import { Path } from "../src/structures/domain.ts";

function makeBox(workdir: string, stdoutRedirect?: ParsedRedirect): SandboxBox {
    const scriptPath = new Path(`${workdir}/__script__.py`);
    return { root: new Path("/proj"), workdir: new Path(workdir), scriptPath, stdoutRedirect, project: undefined };
}

function makeTempDir(files: Record<string, string | Buffer>): string {
    const tempDir = mkdtempSync(join(tmpdir(), "reveng-snapshot-test-"));
    writeTempFiles(tempDir, files);
    return tempDir;
}

function writeTempFiles(tempDir: string, files: Record<string, string | Buffer>): void {
    for (const [relativePath, content] of Object.entries(files)) {
        mkdirSync(dirname(join(tempDir, relativePath)), { recursive: true });
        writeFileSync(join(tempDir, relativePath), content);
    }
}

test("test_snapshotSandboxFiles_hashes_regular_files_and_skips_git_and_symlinks", () => {
    const tempDir = makeTempDir({ "a.txt": "one", "sub/b.txt": "two", ".git/HEAD": "ref", "sub/.git/x": "y" });
    try {
        symlinkSync(join(tempDir, "a.txt"), join(tempDir, "link.txt"));
        const hashes = snapshotSandboxFiles(tempDir);
        assert.deepEqual([...hashes.keys()].sort(), ["a.txt", "sub/b.txt"]);
        // Same content gives the same hash; different content gives a different hash.
        assert.notEqual(hashes.get("a.txt"), hashes.get("sub/b.txt"));
        assert.equal(hashes.get("a.txt"), snapshotSandboxFiles(tempDir).get("a.txt"));
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_reports_a_text_file_the_run_changed", () => {
    const tempDir = makeTempDir({ "a.txt": "one" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { "a.txt": "two" });
        const post = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
        assert.deepEqual(Object.fromEntries(post), { "a.txt": "two" });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_leaves_out_an_untouched_project_file", () => {
    const tempDir = makeTempDir({ "project.txt": "committed" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        const post = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
        assert.equal(post.size, 0);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_reports_a_new_file", () => {
    const tempDir = makeTempDir({ "project.txt": "committed" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { "new/made.txt": "fresh" });
        const post = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
        assert.deepEqual(Object.fromEntries(post), { "new/made.txt": "fresh" });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_never_reports_a_git_change", () => {
    const tempDir = makeTempDir({ ".git/HEAD": "ref: one" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { ".git/HEAD": "ref: two", ".git/objects/new": "blob" });
        const post = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
        assert.equal(post.size, 0);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_leaves_out_a_changed_binary_file_and_keeps_the_text_file_beside_it", () => {
    const tempDir = makeTempDir({});
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { "data.bin": Buffer.from([0xff, 0xfe]), "note.txt": "text" });
        const post = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
        assert.deepEqual(Object.fromEntries(post), { "note.txt": "text" });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_never_reports_the_script_file_when_the_run_changes_it", () => {
    const tempDir = makeTempDir({ "__script__.py": "print(1)" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { "__script__.py": "print(2)" });
        const post = collectBoxPostState(tempDir, makeBox("/proj"), new Map(), baseline);
        assert.equal(post.has("__script__.py"), false);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_gives_the_script_key_its_pre_value_when_pre_has_one", () => {
    const tempDir = makeTempDir({ "__script__.py": "print(1)" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { "__script__.py": "print(2)" });
        const preState = new Map([["__script__.py", "print(1)"]]);
        const post = collectBoxPostState(tempDir, makeBox("/proj"), preState, baseline);
        assert.equal(post.get("__script__.py"), "print(1)");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_keeps_a_start_file_that_still_exists_and_drops_a_deleted_one", () => {
    const tempDir = makeTempDir({ "kept.txt": "k", "gone.txt": "g" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        rmSync(join(tempDir, "gone.txt"));
        const preState = new Map([["kept.txt", "k"], ["gone.txt", "g"]]);
        const post = collectBoxPostState(tempDir, makeBox("/proj"), preState, baseline);
        assert.deepEqual(Object.fromEntries(post), { "kept.txt": "k" });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_collectBoxPostState_keys_are_relative_to_the_workdir_and_may_start_with_dot_dot", () => {
    // Scenario: workdir /proj/sub; the run changes sub/in.txt and other/out.txt.
    const tempDir = makeTempDir({ "sub/in.txt": "a", "other/out.txt": "b" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        writeTempFiles(tempDir, { "sub/in.txt": "a2", "other/out.txt": "b2" });
        const post = collectBoxPostState(tempDir, makeBox("/proj/sub"), new Map(), baseline);
        assert.deepEqual(Object.fromEntries(post), { "in.txt": "a2", "../other/out.txt": "b2" });
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_applyStdoutRedirect_overwrite_replaces_a_committed_file", () => {
    const tempDir = makeTempDir({ "docs/out.md": "old\n" });
    try {
        const box = makeBox("/proj", { target: new Path("docs/out.md"), appends: false });
        applyStdoutRedirect(tempDir, box, "new\n");
        assert.equal(readFileSync(join(tempDir, "docs/out.md"), "utf8"), "new\n");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_applyStdoutRedirect_append_keeps_the_existing_content", () => {
    const tempDir = makeTempDir({ "log.txt": "old\n" });
    try {
        const box = makeBox("/proj", { target: new Path("log.txt"), appends: true });
        applyStdoutRedirect(tempDir, box, "new\n");
        assert.equal(readFileSync(join(tempDir, "log.txt"), "utf8"), "old\nnew\n");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_applyStdoutRedirect_resolves_a_relative_target_against_the_workdir", () => {
    const tempDir = makeTempDir({});
    try {
        const box = makeBox("/proj/sub", { target: new Path("out.md"), appends: false });
        applyStdoutRedirect(tempDir, box, "x\n");
        assert.equal(readFileSync(join(tempDir, "sub/out.md"), "utf8"), "x\n");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_applyStdoutRedirect_writes_an_absolute_target_inside_the_root", () => {
    const tempDir = makeTempDir({});
    try {
        const box = makeBox("/proj/sub", { target: new Path("/proj/docs/o.md"), appends: false });
        applyStdoutRedirect(tempDir, box, "x\n");
        assert.equal(readFileSync(join(tempDir, "docs/o.md"), "utf8"), "x\n");
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_applyStdoutRedirect_writes_nothing_for_a_target_outside_the_root", () => {
    const tempDir = makeTempDir({ "a.txt": "one" });
    try {
        const baseline = snapshotSandboxFiles(tempDir);
        const outsideTargets = ["/tmp/reveng-redirect-outside-test.txt", "../../escape.txt"];
        for (const outsideTarget of outsideTargets) {
            const box = makeBox("/proj", { target: new Path(outsideTarget), appends: false });
            applyStdoutRedirect(tempDir, box, "x\n");
        }
        assert.deepEqual(snapshotSandboxFiles(tempDir), baseline);
        assert.equal(existsSync("/tmp/reveng-redirect-outside-test.txt"), false);
        assert.equal(existsSync(join(tempDir, "../escape.txt")), false);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

test("test_applyStdoutRedirect_writes_nothing_when_the_command_has_no_redirect", () => {
    const tempDir = makeTempDir({});
    try {
        applyStdoutRedirect(tempDir, makeBox("/proj"), "x\n");
        assert.equal(snapshotSandboxFiles(tempDir).size, 0);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
});

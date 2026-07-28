// Tests for src/viewer_api_projects.ts: project scanning, the runtime-switchable projects dir, and the project-file resolver (a trust boundary). The blob-snapshot read tests live in viewer-api-blob-snapshots.test.ts (split for the 250-line cap).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    scanProjects,
    resolveProjectFile,
    getProjectsDir,
    setProjectsDir,
    ROOT_PROJECT_NAME,
} from "../src/viewer_api_projects.ts";
import { Path } from "../src/structures/domain.ts";

// -------------------- 2.2 scanProjects --------------------

test("test_scanProjects_lists_directories_with_jsonl_counts", () => {
    // Scenario: a projects dir with two project dirs — one holding 2 JSONLs, one holding none — scans to two listings sorted by most recent activity, the empty one included with [].
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-scan-"));
    try {
        // Steps: create project dir "alpha" with two .jsonl files at known mtimes.
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
        writeFileSync(join(projectsDir, "alpha", "two.jsonl"), "{}\n");
        utimesSync(join(projectsDir, "alpha", "one.jsonl"), new Date("2026-01-01T00:00:01Z"), new Date("2026-01-01T00:00:01Z"));
        utimesSync(join(projectsDir, "alpha", "two.jsonl"), new Date("2026-01-02T00:00:02Z"), new Date("2026-01-02T00:00:02Z"));
        // create project dir "beta" with no JSONLs.
        mkdirSync(join(projectsDir, "beta"));
        // scan.
        const listings = scanProjects(new Path(projectsDir));
        // assert both projects appear, most recently active first, the empty one with [].
        assert.deepEqual(listings.map((listing) => listing.name), ["alpha", "beta"]);
        assert.equal(listings[0]!.jsonlFiles.length, 2);
        assert.deepEqual(listings[1]!.jsonlFiles, []);
        // assert each JSONL entry carries fileName, sizeBytes, and modifiedAt.
        const fileEntry = listings[0]!.jsonlFiles.find((entry) => entry.fileName.toString() === "two.jsonl");
        assert.ok(fileEntry !== undefined);
        assert.equal(fileEntry.sizeBytes, 3);
        assert.equal(fileEntry.modifiedAt.toISOString(), "2026-01-02T00:00:02.000Z");
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_scanProjects_ignores_non_directories", () => {
    // Scenario: a stray non-JSONL file sitting in the projects dir is not a project.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-scan-"));
    try {
        // Steps: put one real project dir and one stray file in the projects dir, then scan.
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "stray.txt"), "not a project");
        const listings = scanProjects(new Path(projectsDir));
        // assert only the directory is listed.
        assert.deepEqual(listings.map((listing) => listing.name), ["alpha"]);
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_scanProjects_treats_loose_jsonls_as_root_project", () => {
    // Scenario: .jsonl files sitting directly in the scanned dir (a folder that is not .claude/projects-shaped) appear as one synthetic "(root)" project, so any folder of JSONLs is loadable.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-scan-"));
    try {
        // Steps: put one loose JSONL directly in the scanned dir, then scan.
        writeFileSync(join(projectsDir, "loose.jsonl"), "{}\n");
        const listings = scanProjects(new Path(projectsDir));
        // assert a synthetic (root) project carries it.
        const rootListing = listings.find((listing) => listing.name === ROOT_PROJECT_NAME);
        assert.ok(rootListing !== undefined);
        assert.deepEqual(rootListing.jsonlFiles.map((entry) => entry.fileName.toString()), ["loose.jsonl"]);
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

// -------------------- 3.1 runtime-switchable projects dir --------------------

test("test_getProjectsDir_throws_before_any_setProjectsDir", () => {
    // Scenario: there is no default scan root — the server refuses to start without --projects-dir, so reading the dir while unset is a loud error.  NOTE: module state — this must stay the FIRST test that touches the projects dir.
    assert.throws(() => getProjectsDir(), /--projects-dir/);
});

test("test_setProjectsDir_rejects_missing_directory", () => {
    // Scenario: pointing the app at a nonexistent path is a loud error (the server maps it to 400), and the active dir is left unchanged.
    const knownDir = mkdtempSync(join(tmpdir(), "reveng-known-"));
    try {
        const before = setProjectsDir(knownDir);
        assert.throws(() => setProjectsDir("/nonexistent/definitely/not/a/dir"));
        assert.equal(getProjectsDir().toString(), before.toString());
    } finally {
        rmSync(knownDir, { recursive: true, force: true });
    }
});

test("test_setProjectsDir_switches_scan_root", () => {
    // Scenario: switching the active dir at runtime makes the scan reflect the new root.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-switch-"));
    try {
        // Steps: put one fake project in a temp root and switch to it.
        mkdirSync(join(projectsDir, "gamma"));
        writeFileSync(join(projectsDir, "gamma", "one.jsonl"), "{}\n");
        const switched = setProjectsDir(projectsDir);
        // assert the scan over the active dir now lists the fake project.
        const listings = scanProjects(switched);
        assert.deepEqual(listings.map((listing) => listing.name), ["gamma"]);
        assert.equal(getProjectsDir().toString(), switched.toString());
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

// -------------------- 2.7 project-file resolver (trust boundary) --------------------

test("test_resolveProjectFile_resolves_names_within_projects_dir", () => {
    // Scenario: a project name + JSONL file name resolve to the real file under the projects dir.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-resolve-"));
    try {
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
        const resolved = resolveProjectFile(new Path(projectsDir), "alpha", "one.jsonl");
        assert.ok(resolved.toString().endsWith(join("alpha", "one.jsonl")));
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_resolveProjectFile_rejects_traversal", () => {
    // Scenario: `project` and `jsonl` are NAMES, not paths — an escape attempt in either position must be rejected, never resolved outside the projects dir.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-resolve-"));
    try {
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
        // a traversal in the jsonl position is rejected.
        assert.throws(() => resolveProjectFile(new Path(projectsDir), "alpha", "../../etc/passwd"));
        // a traversal in the project position is rejected.
        assert.throws(() => resolveProjectFile(new Path(projectsDir), "../..", "one.jsonl"));
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_resolveProjectFile_resolves_root_project_files", () => {
    // Scenario: the synthetic "(root)" project resolves its files directly against the projects dir itself.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-resolve-"));
    try {
        writeFileSync(join(projectsDir, "loose.jsonl"), "{}\n");
        const resolved = resolveProjectFile(new Path(projectsDir), ROOT_PROJECT_NAME, "loose.jsonl");
        assert.ok(resolved.toString().endsWith("loose.jsonl"));
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

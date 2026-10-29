// Tests for project scanning, the switchable projects dir, and the project-file resolver.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getProjectsDir, setProjectsDir } from "../src/viewer_api_projects.ts";
import { ROOT_PROJECT_NAME, scanProjects } from "../src/viewer_api_project_scan.ts";
import { findProjectFile } from "../src/viewer_api_trust_boundary.ts";
import { Path } from "../src/structures/domain.ts";

// -------------------- 2.2 scanProjects --------------------

test("test_scanProjects_lists_directories_with_jsonl_counts", () => {
    // Scenario: two project dirs scan to two listings, newest activity first, the empty one with [].
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-scan-"));
    try {
        // Project "alpha" has two .jsonl files at known mtimes.
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
        writeFileSync(join(projectsDir, "alpha", "two.jsonl"), "{}\n");
        utimesSync(join(projectsDir, "alpha", "one.jsonl"), new Date("2026-01-01T00:00:01Z"), new Date("2026-01-01T00:00:01Z"));
        utimesSync(join(projectsDir, "alpha", "two.jsonl"), new Date("2026-01-02T00:00:02Z"), new Date("2026-01-02T00:00:02Z"));
        // Project "beta" has no JSONLs.
        mkdirSync(join(projectsDir, "beta"));
        const listings = scanProjects(new Path(projectsDir));
        assert.deepEqual(listings.map((listing) => listing.name), ["alpha", "beta"]);
        assert.equal(listings[0]!.jsonlFiles.length, 2);
        assert.deepEqual(listings[1]!.jsonlFiles, []);
        // Each JSONL entry carries fileName, sizeBytes, and modifiedAt.
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
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "stray.txt"), "not a project");
        const listings = scanProjects(new Path(projectsDir));
        assert.deepEqual(listings.map((listing) => listing.name), ["alpha"]);
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_scanProjects_treats_loose_jsonls_as_root_project", () => {
    // Scenario: loose .jsonl files in the scanned dir appear as one synthetic "(root)" project.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-scan-"));
    try {
        writeFileSync(join(projectsDir, "loose.jsonl"), "{}\n");
        const listings = scanProjects(new Path(projectsDir));
        const rootListing = listings.find((listing) => listing.name === ROOT_PROJECT_NAME);
        assert.ok(rootListing !== undefined);
        assert.deepEqual(rootListing.jsonlFiles.map((entry) => entry.fileName.toString()), ["loose.jsonl"]);
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

// -------------------- 3.1 runtime-switchable projects dir --------------------

test("test_getProjectsDir_throws_before_any_setProjectsDir", () => {
    // Scenario: reading the projects dir while unset throws.  Module state: keep this the first test to touch it.
    assert.throws(() => getProjectsDir(), /--projects-dir/);
});

test("test_setProjectsDir_rejects_missing_directory", () => {
    // Scenario: a nonexistent path throws and leaves the active dir unchanged.
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
        mkdirSync(join(projectsDir, "gamma"));
        writeFileSync(join(projectsDir, "gamma", "one.jsonl"), "{}\n");
        const switched = setProjectsDir(projectsDir);
        const listings = scanProjects(switched);
        assert.deepEqual(listings.map((listing) => listing.name), ["gamma"]);
        assert.equal(getProjectsDir().toString(), switched.toString());
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

// -------------------- 2.7 project-file resolver (trust boundary) --------------------

test("test_findProjectFile_resolves_names_within_projects_dir", () => {
    // Scenario: a project name + JSONL file name resolve to the real file under the projects dir.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-resolve-"));
    try {
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
        const resolved = findProjectFile(new Path(projectsDir), "alpha", "one.jsonl");
        assert.ok(resolved.toString().endsWith(join("alpha", "one.jsonl")));
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_findProjectFile_rejects_traversal", () => {
    // Scenario: `project` and `jsonl` are names, so an escape attempt in either throws.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-resolve-"));
    try {
        mkdirSync(join(projectsDir, "alpha"));
        writeFileSync(join(projectsDir, "alpha", "one.jsonl"), "{}\n");
        assert.throws(() => findProjectFile(new Path(projectsDir), "alpha", "../../etc/passwd"));
        assert.throws(() => findProjectFile(new Path(projectsDir), "../..", "one.jsonl"));
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

test("test_findProjectFile_resolves_root_project_files", () => {
    // Scenario: the synthetic "(root)" project resolves files directly against the projects dir.
    const projectsDir = mkdtempSync(join(tmpdir(), "reveng-resolve-"));
    try {
        writeFileSync(join(projectsDir, "loose.jsonl"), "{}\n");
        const resolved = findProjectFile(new Path(projectsDir), ROOT_PROJECT_NAME, "loose.jsonl");
        assert.ok(resolved.toString().endsWith("loose.jsonl"));
    } finally {
        rmSync(projectsDir, { recursive: true, force: true });
    }
});

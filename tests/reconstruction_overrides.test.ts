// Tests for path-overrides: module state, cache-stamp formatting, and the reveng-paths.json config.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import {
    getPathOverrides,
    setPathOverrides,
    formatPathOverrides,
    readProjectPathsConfig,
    writeProjectPathsEntry,
    PROJECT_PATHS_CONFIG_NAME,
} from "../src/reconstruction_overrides.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

test("test_set_and_get_path_overrides_round_trip", () => {
    // Scenario: the module stores exactly what was set, and setting {} clears it.  Step: set a fully-populated override object.
    const overrides = {
        fileHistoryRoot: new Path("/tmp/claude-data/file-history"),
        projectCwd: new Path("/tmp/original/project"),
        repoDir: new Path("/tmp/original/project"),
        baseCommit: new Uuid("abc123def456"),
    };
    setPathOverrides(overrides);
    // Step: get returns the same values.
    assert.equal(getPathOverrides().fileHistoryRoot?.toString(), "/tmp/claude-data/file-history");
    assert.equal(getPathOverrides().projectCwd?.toString(), "/tmp/original/project");
    assert.equal(getPathOverrides().repoDir?.toString(), "/tmp/original/project");
    assert.equal(getPathOverrides().baseCommit?.toString(), "abc123def456");
    // Step: setting {} returns the module to empty.
    setPathOverrides({});
    assert.equal(getPathOverrides().fileHistoryRoot, undefined);
    assert.equal(getPathOverrides().projectCwd, undefined);
    assert.equal(getPathOverrides().repoDir, undefined);
    assert.equal(getPathOverrides().baseCommit, undefined);
});

test("test_serialize_path_overrides_is_stable_and_distinguishes_values", () => {
    // Scenario: identical overrides format identically; any field change changes the stamp.
    setPathOverrides({});
    const emptySerialization = formatPathOverrides();
    // Step: the same override set serializes identically across two set calls.
    setPathOverrides({ repoDir: new Path("/tmp/repo") });
    const firstSerialization = formatPathOverrides();
    setPathOverrides({ repoDir: new Path("/tmp/repo") });
    assert.equal(formatPathOverrides(), firstSerialization);
    // Step: changing one field changes the string.
    setPathOverrides({ repoDir: new Path("/tmp/other-repo") });
    assert.notEqual(formatPathOverrides(), firstSerialization);
    // Step: a defined field never serializes like the empty state.
    assert.notEqual(firstSerialization, emptySerialization);
});

test("test_read_project_paths_config_returns_empty_map_when_file_missing", () => {
    // Scenario: a projects folder with no reveng-paths.json means no overrides.
    const projectsDir = makeTempDir();
    // Step: the read yields an empty map, no throw.
    assert.deepEqual(readProjectPathsConfig(new Path(projectsDir)), {});
});

test("test_read_project_paths_config_reads_project_entry", () => {
    // Scenario: a config file maps project dir names to their path entries.
    const projectsDir = makeTempDir();
    const wireConfig = {
        "-Users-me-Programming-jot": {
            cwd: "/Users/me/Programming/jot",
            repo: "/Users/me/Programming/jot",
            baseCommit: "deadbeef",
        },
    };
    writeFileSync(join(projectsDir, PROJECT_PATHS_CONFIG_NAME), JSON.stringify(wireConfig));
    // Step: reading it back yields the same entry under the project name.
    const config = readProjectPathsConfig(new Path(projectsDir));
    assert.deepEqual(config["-Users-me-Programming-jot"], wireConfig["-Users-me-Programming-jot"]);
});

test("test_read_project_paths_config_throws_on_malformed_json", () => {
    // Scenario: a malformed config must fail loudly, never silently drop the overrides.
    const projectsDir = makeTempDir();
    writeFileSync(join(projectsDir, PROJECT_PATHS_CONFIG_NAME), "not json");
    // Step: the read throws.
    assert.throws(() => readProjectPathsConfig(new Path(projectsDir)));
});

test("test_write_project_paths_entry_merges_into_existing_config", () => {
    // Scenario: writing an entry merges field-wise; other projects survive and a missing file is created.
    const projectsDir = makeTempDir();
    writeFileSync(join(projectsDir, PROJECT_PATHS_CONFIG_NAME), JSON.stringify({
        "proj-a": { cwd: "/original/a" },
        "proj-b": { repo: "/repos/b" },
    }));
    // Step: store repo + baseCommit for proj-a.
    writeProjectPathsEntry(new Path(projectsDir), "proj-a", { repo: "/repos/a", baseCommit: "abc123" });
    const config = readProjectPathsConfig(new Path(projectsDir));
    // the stored cwd survives the merge; the new fields land beside it.
    assert.deepEqual(config["proj-a"], { cwd: "/original/a", repo: "/repos/a", baseCommit: "abc123" });
    // the unrelated project is untouched.
    assert.deepEqual(config["proj-b"], { repo: "/repos/b" });
    // Step: a brand-new project name creates its entry (and would create the file if missing).
    const emptyProjectsDir = makeTempDir();
    writeProjectPathsEntry(new Path(emptyProjectsDir), "proj-new", { fileHistory: "/tmp/fh" });
    assert.deepEqual(readProjectPathsConfig(new Path(emptyProjectsDir))["proj-new"], { fileHistory: "/tmp/fh" });
});

test("test_serialize_path_overrides_includes_sources", () => {
    // Scenario: a source-list change must change the cache stamp.
    setPathOverrides({});
    const emptyStamp = formatPathOverrides();
    // Test action: set overrides carrying one declared source (with root, no fileHistoryDir).
    setPathOverrides({
        sources: [{ projectsDir: new Path("/tmp/live/projects"), root: new Path("/tmp/ws") }],
    });
    const sourcedStamp = formatPathOverrides();
    // Test verification: the stamp changed, and it is deterministic across calls.
    assert.notEqual(sourcedStamp, emptyStamp);
    assert.equal(sourcedStamp, formatPathOverrides());
    // the source's fields are all present in the stamp (fixed key order via JSON round-trip).
    assert.ok(sourcedStamp.includes("/tmp/live/projects"));
    assert.ok(sourcedStamp.includes("/tmp/ws"));
});

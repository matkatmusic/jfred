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
    buildProjectPaths,
    buildProjectSources,
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

test("test_hydrate_project_paths_builds_domain_types", () => {
    // Scenario: parsing hydrates wire strings into domain objects (coding-req §1).  Step: hydrate a full wire entry.
    const overrides = buildProjectPaths({
        cwd: "/Users/me/Programming/jot",
        repo: "/Users/me/Programming/jot",
        baseCommit: "deadbeef",
    });
    // Step: each field is a real domain instance carrying the wire value.
    assert.ok(overrides.projectCwd instanceof Path);
    assert.ok(overrides.repoDir instanceof Path);
    assert.ok(overrides.baseCommit instanceof Uuid);
    assert.equal(overrides.projectCwd.toString(), "/Users/me/Programming/jot");
    assert.equal(overrides.baseCommit.toString(), "deadbeef");
    // Step: absent wire fields stay absent after hydration.
    const partialOverrides = buildProjectPaths({ repo: "/tmp/repo" });
    assert.equal(partialOverrides.projectCwd, undefined);
    assert.equal(partialOverrides.baseCommit, undefined);
    assert.equal(partialOverrides.fileHistoryRoot, undefined);
});

test("test_hydrate_project_paths_maps_fileHistory_to_fileHistoryRoot", () => {
    // Scenario: a per-project fileHistory entry becomes the fileHistoryRoot override.
    const overrides = buildProjectPaths({ fileHistory: "/tmp/custom-history" });
    // Step: the field is a real Path carrying the wire value.
    assert.ok(overrides.fileHistoryRoot instanceof Path);
    assert.equal(overrides.fileHistoryRoot.toString(), "/tmp/custom-history");
});

test("test_hydrate_project_sources_builds_domain_entries_from_sources_list", () => {
    // Scenario: a `sources` list becomes domain Paths, keeping order and optional fields.
    const sourceEntries = buildProjectSources(new Path("/tmp/live/projects"), {
        sources: [
            { projectsDir: "/tmp/live/projects", fileHistoryDir: "/tmp/live/file-history", root: "/Users/me/Programming/jot" },
            { projectsDir: "/tmp/backup/projects" },
        ],
    });
    // Step: both entries hydrate, in declaration order.
    assert.equal(sourceEntries.length, 2);
    // Step: every populated field is a real Path carrying the wire value.
    assert.ok(sourceEntries[0]!.projectsDir instanceof Path);
    assert.equal(sourceEntries[0]!.projectsDir.toString(), "/tmp/live/projects");
    assert.equal(sourceEntries[0]!.fileHistoryDir?.toString(), "/tmp/live/file-history");
    assert.equal(sourceEntries[0]!.root?.toString(), "/Users/me/Programming/jot");
    assert.equal(sourceEntries[1]!.projectsDir.toString(), "/tmp/backup/projects");
});

test("test_hydrate_project_sources_degenerates_legacy_entry_to_single_source", () => {
    // Scenario: a legacy entry with no `sources` yields one source: the config's own projects dir.
    const legacyWire = { cwd: "/Users/me/jot", repo: "/Users/me/jot", baseCommit: "deadbeef", fileHistory: "/tmp/custom-history" };
    const sourceEntries = buildProjectSources(new Path("/tmp/live/projects"), legacyWire);
    // Step: exactly one source — the containing projects dir.
    assert.equal(sourceEntries.length, 1);
    assert.equal(sourceEntries[0]!.projectsDir.toString(), "/tmp/live/projects");
    // Step: the legacy fileHistory override rides along as the source's fileHistoryDir.
    assert.equal(sourceEntries[0]!.fileHistoryDir?.toString(), "/tmp/custom-history");
    // Step: root stays absent — legacy entries never declared one.
    assert.equal(sourceEntries[0]!.root, undefined);
    // Step: legacy hydration is untouched — the same wire still yields the same overrides.
    const overrides = buildProjectPaths(legacyWire);
    assert.equal(overrides.projectCwd?.toString(), "/Users/me/jot");
    assert.equal(overrides.fileHistoryRoot?.toString(), "/tmp/custom-history");
});

test("test_hydrate_project_sources_leaves_omitted_root_absent_for_auto_detect", () => {
    // Scenario: an omitted `root` means auto-detect, so it must stay absent.
    const sourceEntries = buildProjectSources(new Path("/tmp/live/projects"), {
        sources: [{ projectsDir: "/tmp/live/projects" }],
    });
    // Step: root and fileHistoryDir are absent on the hydrated entry.
    assert.equal(sourceEntries[0]!.root, undefined);
    assert.equal(sourceEntries[0]!.fileHistoryDir, undefined);
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

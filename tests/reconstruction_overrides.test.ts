// Tests for the item-46 path-overrides module: process-wide override state, stable
// serialization for cache stamps, and the reveng-paths.json per-project config file.
// The Phase-2 file-history-root resolution tests live in
// tests/reconstruction_sidecar_reader.test.ts.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import {
    getPathOverrides,
    setPathOverrides,
    serializePathOverrides,
    readProjectPathsConfig,
    hydrateProjectPaths,
    hydrateProjectSources,
    writeProjectPathsEntry,
    PROJECT_PATHS_CONFIG_NAME,
} from "../src/reconstruction_overrides.ts";
import { makeTempDir } from "./overrides-test-helpers.ts";

// Overrides are process-wide module state — never let one test's state leak into the next.
afterEach(() => {
    setPathOverrides({});
});

test("test_set_and_get_path_overrides_round_trip", () => {
    // Scenario: the module stores exactly what was set, and setting {} clears it.
    // Step: set a fully-populated override object.
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
    // Scenario: the serialization is a cache-stamp component — identical overrides must
    // serialize identically, any field change must change the string.
    // Step: empty overrides serialize to a fixed constant.
    setPathOverrides({});
    const emptySerialization = serializePathOverrides();
    // Step: the same override set serializes identically across two set calls.
    setPathOverrides({ repoDir: new Path("/tmp/repo") });
    const firstSerialization = serializePathOverrides();
    setPathOverrides({ repoDir: new Path("/tmp/repo") });
    assert.equal(serializePathOverrides(), firstSerialization);
    // Step: changing one field changes the string.
    setPathOverrides({ repoDir: new Path("/tmp/other-repo") });
    assert.notEqual(serializePathOverrides(), firstSerialization);
    // Step: a defined field never serializes like the empty state.
    assert.notEqual(firstSerialization, emptySerialization);
});

test("test_read_project_paths_config_returns_empty_map_when_file_missing", () => {
    // Scenario: a projects folder with no reveng-paths.json means "no overrides".
    // Step: point at a temp dir that has no config file.
    const projectsDir = makeTempDir();
    // Step: the read yields an empty map, no throw.
    assert.deepEqual(readProjectPathsConfig(new Path(projectsDir)), {});
});

test("test_read_project_paths_config_reads_project_entry", () => {
    // Scenario: a config file maps project dir names to their path entries.
    // Step: write a config with one project entry into a temp projects dir.
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
    // Scenario: a typo'd config must fail loudly, never silently drop the overrides.
    // Step: write malformed JSON as the config file.
    const projectsDir = makeTempDir();
    writeFileSync(join(projectsDir, PROJECT_PATHS_CONFIG_NAME), "not json");
    // Step: the read throws.
    assert.throws(() => readProjectPathsConfig(new Path(projectsDir)));
});

test("test_hydrate_project_paths_builds_domain_types", () => {
    // Scenario: parsing hydrates wire strings into domain objects (coding-req §1).
    // Step: hydrate a full wire entry.
    const overrides = hydrateProjectPaths({
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
    const partialOverrides = hydrateProjectPaths({ repo: "/tmp/repo" });
    assert.equal(partialOverrides.projectCwd, undefined);
    assert.equal(partialOverrides.baseCommit, undefined);
    assert.equal(partialOverrides.fileHistoryRoot, undefined);
});

test("test_hydrate_project_paths_maps_fileHistory_to_fileHistoryRoot", () => {
    // Scenario (task 137): a per-project explicit file-history override rides in the same
    // reveng-paths.json entry and hydrates into the engine's fileHistoryRoot override.
    // Step: hydrate an entry carrying only fileHistory.
    const overrides = hydrateProjectPaths({ fileHistory: "/tmp/custom-history" });
    // Step: the field is a real Path carrying the wire value.
    assert.ok(overrides.fileHistoryRoot instanceof Path);
    assert.equal(overrides.fileHistoryRoot.toString(), "/tmp/custom-history");
});

test("test_hydrate_project_sources_builds_domain_entries_from_sources_list", () => {
    // Scenario (spec S3): a project entry may declare a `sources` list; each entry hydrates
    // into domain Paths (coding-req §1), preserving order and per-entry optional fields.
    // Step: hydrate a wire entry carrying two sources — one fully populated, one minimal.
    const sourceEntries = hydrateProjectSources(new Path("/tmp/live/projects"), {
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
    // Scenario (spec S3): a legacy entry (no `sources` key) is the one-entry degenerate
    // case — the single source is the config's own projects dir, carrying the legacy
    // fileHistory override, with root absent (auto-detect, design §b).
    // Step: hydrate a fully-populated LEGACY wire entry.
    const legacyWire = { cwd: "/Users/me/jot", repo: "/Users/me/jot", baseCommit: "deadbeef", fileHistory: "/tmp/custom-history" };
    const sourceEntries = hydrateProjectSources(new Path("/tmp/live/projects"), legacyWire);
    // Step: exactly one source — the containing projects dir.
    assert.equal(sourceEntries.length, 1);
    assert.equal(sourceEntries[0]!.projectsDir.toString(), "/tmp/live/projects");
    // Step: the legacy fileHistory override rides along as the source's fileHistoryDir.
    assert.equal(sourceEntries[0]!.fileHistoryDir?.toString(), "/tmp/custom-history");
    // Step: root stays absent — legacy entries never declared one.
    assert.equal(sourceEntries[0]!.root, undefined);
    // Step: legacy hydration is untouched — the same wire still yields the same overrides.
    const overrides = hydrateProjectPaths(legacyWire);
    assert.equal(overrides.projectCwd?.toString(), "/Users/me/jot");
    assert.equal(overrides.fileHistoryRoot?.toString(), "/tmp/custom-history");
});

test("test_hydrate_project_sources_leaves_omitted_root_absent_for_auto_detect", () => {
    // Scenario (design §b): an omitted `root` is the auto-detect signal — hydration must
    // leave it absent, never invent a value.
    // Step: hydrate a sources entry that omits root (and fileHistoryDir).
    const sourceEntries = hydrateProjectSources(new Path("/tmp/live/projects"), {
        sources: [{ projectsDir: "/tmp/live/projects" }],
    });
    // Step: root and fileHistoryDir are absent on the hydrated entry.
    assert.equal(sourceEntries[0]!.root, undefined);
    assert.equal(sourceEntries[0]!.fileHistoryDir, undefined);
});

test("test_write_project_paths_entry_merges_into_existing_config", () => {
    // Scenario (task 137's opt-in store): writing one project's entry merges field-wise into
    // the existing file — stored fields absent from the new entry survive, other projects
    // stay untouched, and a missing file is created.
    // Step: a config with an existing entry for "proj-a" plus an unrelated "proj-b".
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

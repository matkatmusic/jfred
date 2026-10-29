// Tests for hydrating wire project entries into path overrides and source entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Path, Uuid } from "../src/structures/domain.ts";
import {
    buildProjectPaths,
    buildProjectSources,
} from "../src/reconstruction_overrides.ts";

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

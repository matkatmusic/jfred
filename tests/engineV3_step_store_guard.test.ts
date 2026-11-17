// The store guards of the step program: the store sits inside the cache folder and holds no full-build repo.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { buildInverseReposForFiles, buildOnDemandInverseReposForFiles, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { assertStoreHasNoFullBuildRepos, assertStoreIsInsideCacheFolder } from "../engineV3/engineV3_step_store_guard.ts";
import { makeEditRows, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function makeTemporaryFolder(t: TestContext): string {
    const folder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-step-guard-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function writeOneEditProject(t: TestContext): Project {
    return writeProject(t, "two\n", (projectFolder, filePath) => makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10));
}

function makeProjectFiles(project: Project): ProjectFile[] {
    return [{ file: project.file, transcriptFile: project.file }];
}

test("test_store_outside_the_cache_folder_throws", (t) => {
    // Scenario: a store that is not under the cache folder is refused.
    // Steps:
    // a cache folder and a store folder sit side by side in one temporary folder.
    const rootFolder = makeTemporaryFolder(t);
    const cacheFolder = join(rootFolder, "cache");
    const storeFolder = join(rootFolder, "x");
    mkdirSync(cacheFolder);
    mkdirSync(storeFolder);
    // the guard throws.
    assert.throws(() => assertStoreIsInsideCacheFolder(new Path(storeFolder), new Path(cacheFolder)));
});

test("test_store_inside_the_cache_folder_passes", (t) => {
    // Scenario: a store one level under the cache folder is accepted.
    // Steps:
    // a store folder sits inside a cache folder.
    const rootFolder = makeTemporaryFolder(t);
    const cacheFolder = join(rootFolder, "cache");
    const storeFolder = join(cacheFolder, "step-a");
    mkdirSync(storeFolder, { recursive: true });
    // the guard does not throw.
    assert.doesNotThrow(() => assertStoreIsInsideCacheFolder(new Path(storeFolder), new Path(cacheFolder)));
});

test("test_store_equal_to_the_cache_folder_throws", (t) => {
    // Scenario: the cache folder itself is not a store.
    // Steps:
    // the store folder is the cache folder.
    const rootFolder = makeTemporaryFolder(t);
    const cacheFolder = join(rootFolder, "cache");
    mkdirSync(cacheFolder);
    // the guard throws.
    assert.throws(() => assertStoreIsInsideCacheFolder(new Path(cacheFolder), new Path(cacheFolder)));
});

test("test_a_symbolic_link_in_the_cache_folder_that_points_outside_it_throws", (t) => {
    // Scenario: a store that is a link out of the cache folder is refused.
    // Steps:
    // a cache folder holds a symbolic link to a folder outside the cache folder.
    const rootFolder = makeTemporaryFolder(t);
    const cacheFolder = join(rootFolder, "cache");
    const outsideFolder = join(rootFolder, "x");
    mkdirSync(cacheFolder);
    mkdirSync(outsideFolder);
    const linkFolder = join(cacheFolder, "link");
    symlinkSync(outsideFolder, linkFolder);
    // the guard throws for the link as store.
    assert.throws(() => assertStoreIsInsideCacheFolder(new Path(linkFolder), new Path(cacheFolder)));
});

test("test_a_full_build_repo_in_the_store_throws", (t) => {
    // Scenario: a store that holds a full-build repo of a project file is refused.
    // Steps:
    // a project file has a full-build repo in the store.
    const project = writeOneEditProject(t);
    buildInverseReposForFiles(project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], [project.snapshotFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    // the guard throws.
    assert.throws(() => assertStoreHasNoFullBuildRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project)));
});

test("test_an_on_demand_repo_in_the_store_passes", (t) => {
    // Scenario: a store that holds only an on-demand repo of a project file is accepted.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandInverseReposForFiles(project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    // the guard does not throw.
    assert.doesNotThrow(() => assertStoreHasNoFullBuildRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project)));
});

test("test_a_file_without_a_repo_passes", (t) => {
    // Scenario: a store with no repo of the project file is accepted.
    // Steps:
    // the store folder is empty.
    const project = writeOneEditProject(t);
    // the guard does not throw.
    assert.doesNotThrow(() => assertStoreHasNoFullBuildRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project)));
});

// The stale repo list: which repos of a store no longer match the logs or the disk.

import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildOnDemandInverseReposForFiles, listProjectFilesWithStaleInverseRepos, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { makeEditRows, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function writeOneEditProject(t: Parameters<typeof writeProject>[0]): Project {
    return writeProject(t, "two\n", (projectFolder, filePath) => makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10));
}

function makeProjectFiles(project: Project): ProjectFile[] {
    return [{ file: project.file, transcriptFile: project.file }];
}

function buildOnDemandRepoForProject(project: Project): void {
    buildOnDemandInverseReposForFiles(project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
}

function listStaleFiles(project: Project): ProjectFile[] {
    return listProjectFilesWithStaleInverseRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder]);
}

test("test_a_repo_made_by_the_on_demand_build_is_not_stale_while_the_logs_stay_equal", (t) => {
    // Scenario: a repo built by the on-demand build is not listed while logs and disk stay equal.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandRepoForProject(project);
    // the stale list is empty.
    assert.deepEqual(listStaleFiles(project), []);
});

test("test_a_repo_is_stale_after_the_log_file_grows", (t) => {
    // Scenario: a repo is listed after one line is added to a log file.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandRepoForProject(project);
    // one line is added to the log file.
    appendFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), JSON.stringify({ type: "summary" }) + "\n");
    // the project file is listed.
    assert.deepEqual(listStaleFiles(project), makeProjectFiles(project));
});

test("test_a_repo_is_stale_after_the_disk_text_changes", (t) => {
    // Scenario: a repo is listed after the text of the file on disk changes.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandRepoForProject(project);
    // the text of the file on disk changes.
    writeFileSync(project.file.toString(), "three\n");
    // the project file is listed.
    assert.deepEqual(listStaleFiles(project), makeProjectFiles(project));
});

test("test_a_file_without_a_repo_folder_is_not_stale_and_no_folder_is_made", (t) => {
    // Scenario: a file with no repo folder is not listed and the call makes no folder.
    // Steps:
    // the store folder exists and is empty.
    const project = writeOneEditProject(t);
    mkdirSync(project.storeFolder.toString());
    const listingBefore = readdirSync(project.storeFolder.toString(), { recursive: true });
    // the stale list is empty.
    assert.deepEqual(listStaleFiles(project), []);
    // the store folder listing is equal to the listing before the call.
    assert.deepEqual(readdirSync(project.storeFolder.toString(), { recursive: true }), listingBefore);
});

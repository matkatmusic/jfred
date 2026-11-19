// A step child given the project cache reads its file list from the cache, not from a new search of every log.
import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { makeEditRows, makeInstant, writeProjectCacheOfProject, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const FILE_SEARCH_PROGRESS_PATTERN = /B: read the cwd|C: \d+\/\d+ logs read|D: \d+\/\d+ logs scanned/;

function writeProjectWithOneEdit(t: TestContext): ProjectWithFiles {
    return writeProjectFiles(t, new Map([["a.txt", "two\n"]]), (projectFolder, filePathByFileName) =>
        makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 10));
}

function spawnStepChild(project: ProjectWithFiles, extraArguments: string[]): SpawnSyncReturns<string> {
    const programArguments = ["--import", "tsx", "engineV3/engineV3_inverse_repos_for_project.ts", "--project", project.projectFolder.toString(), "--jsonls", project.jsonlsFolder.toString(), "--file-history", project.snapshotFolder.toString(), "--store", project.storeFolder.toString(), "--step", "a.txt", "--startAt", makeInstant(5).toISOString(), ...extraArguments];
    return spawnSync(process.execPath, programArguments, { input: "q\n", cwd: join(import.meta.dirname, ".."), encoding: "utf8", timeout: 110000 });
}

test("test_a_step_child_without_a_project_cache_searches_the_logs_for_the_project_files", (t) => {
    // Scenario: a project with one edit of a.txt; the child gets no project cache.
    const project = writeProjectWithOneEdit(t);
    const spawned = spawnStepChild(project, []);
    // the child ends with status 0 and prints its file search progress.
    assert.equal(spawned.status, 0, spawned.stderr);
    assert.match(spawned.stderr, FILE_SEARCH_PROGRESS_PATTERN);
});

test("test_a_step_child_with_a_project_cache_does_not_search_the_logs_for_the_project_files", (t) => {
    // Scenario: the same project; its project cache is written to a file and the child gets that file.
    const project = writeProjectWithOneEdit(t);
    const cacheFile = writeProjectCacheOfProject(project);
    const spawned = spawnStepChild(project, ["--project-cache", cacheFile.toString()]);
    // the child ends with status 0 and still reports its step outcome.
    assert.equal(spawned.status, 0, spawned.stderr);
    assert.match(spawned.stdout, /"outcome"/);
    // the child prints no file search progress.
    assert.doesNotMatch(spawned.stderr, FILE_SEARCH_PROGRESS_PATTERN);
});

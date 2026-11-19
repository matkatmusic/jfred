// The single file events loader reads only the log lines that name its own file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createProjectEventsLoader, createSingleFileEventsLoader } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { makeEditRows, makeInstant, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const BROKEN_LINE_NAMING_ONLY_B = '{"type":"assistant", this line is broken JSON and names b.txt\n';

// a.txt has one Edit in the log; the log ends with a broken line that names only b.txt.
function writeProjectWithBrokenLineNamingB(t: Parameters<typeof writeProjectFiles>[0]): ProjectWithFiles {
    const project = writeProjectFiles(t, new Map([["a.txt", "two\n"], ["b.txt", "other\n"]]), (projectFolder, filePathByFileName) =>
        makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 10));
    appendFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), BROKEN_LINE_NAMING_ONLY_B);
    return project;
}

test("test_the_all_files_loader_fails_on_a_broken_line_that_names_another_file", (t) => {
    // Scenario: the broken line names b.txt; the all-files loader searches for b.txt too.
    const project = writeProjectWithBrokenLineNamingB(t);
    const projectFiles = [project.fileByName.get("a.txt")!, project.fileByName.get("b.txt")!].map((file) => ({ file, transcriptFile: file }));
    const getEvents = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder]);
    // asking for a.txt reads the broken line and throws.
    assert.throws(() => getEvents(0));
});

test("test_the_single_file_loader_ignores_a_broken_line_that_names_another_file", (t) => {
    // Scenario: the same project and log as above.
    const project = writeProjectWithBrokenLineNamingB(t);
    const projectFiles = [project.fileByName.get("a.txt")!, project.fileByName.get("b.txt")!].map((file) => ({ file, transcriptFile: file }));
    const getEvents = createSingleFileEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder]);
    // asking for a.txt returns the same events the all-files loader gives for a log without the broken line.
    const cleanProject = writeProjectFiles(t, new Map([["a.txt", "two\n"], ["b.txt", "other\n"]]), (projectFolder, filePathByFileName) =>
        makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 10));
    const cleanFiles = [cleanProject.fileByName.get("a.txt")!, cleanProject.fileByName.get("b.txt")!].map((file) => ({ file, transcriptFile: file }));
    const expectedEvents = createProjectEventsLoader(cleanFiles, [cleanProject.jsonlsFolder], [cleanProject.snapshotFolder])(0);
    const events = getEvents(0);
    assert.ok(events.length > 0);
    assert.deepEqual(events.map((event) => event.type), expectedEvents.map((event) => event.type));
});

test("test_the_step_program_for_a_ignores_a_broken_line_that_names_b", (t) => {
    // Scenario: a.txt and b.txt both have an Edit in the log, and a broken line names b.txt; the step program walks a.txt only.
    const project = writeProjectFiles(t, new Map([["a.txt", "two\n"], ["b.txt", "other\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePathByFileName.get("b.txt")!, "x", "other", null, 20),
    ]);
    appendFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), BROKEN_LINE_NAMING_ONLY_B);
    const programArguments = ["--import", "tsx", "engineV3/engineV3_inverse_repos_for_project.ts", "--project", project.projectFolder.toString(), "--jsonls", project.jsonlsFolder.toString(), "--file-history", project.snapshotFolder.toString(), "--store", project.storeFolder.toString(), "--step", "a.txt", "--startAt", makeInstant(5).toISOString()];
    const spawned = spawnSync(process.execPath, programArguments, { input: "q\n", cwd: join(import.meta.dirname, ".."), encoding: "utf8", timeout: 110000 });
    // the program ends with status 0.
    assert.equal(spawned.status, 0, spawned.stderr);
});

test("test_the_single_file_loader_returns_the_same_events_when_asked_twice", (t) => {
    // Scenario: a.txt is asked for two times.
    const project = writeProjectWithBrokenLineNamingB(t);
    const projectFiles = [project.fileByName.get("a.txt")!, project.fileByName.get("b.txt")!].map((file) => ({ file, transcriptFile: file }));
    const getEvents = createSingleFileEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder]);
    // the second answer is the very same array: the log is read once per file.
    assert.equal(getEvents(0), getEvents(0));
});

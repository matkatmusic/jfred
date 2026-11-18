// The View File box data: when the box can open, which instant it reads, and its lines.

import assert from "node:assert/strict";
import { basename } from "node:path";
import { test, type TestContext } from "node:test";
import { Path } from "../src/structures/domain.ts";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { readFileTextAtInstant } from "../engineV3/tui/engineV3_tui_file_view_text.ts";
import { buildViewFileLines, canOpenViewFile, computeViewFileInstant } from "../engineV3/tui/engineV3_tui_view_file.ts";
import { makeEditRows, makeInstant, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const FAR_FUTURE_INSTANT = new Date(Date.UTC(2100, 0, 1));

// Disk text "three"; Edit one to two at second 10, Edit two to three at second 20. Not walked yet.
function writeUnwalkedProject(t: TestContext): Project {
    return writeProject(t, "three\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
}

function walkProject(project: Project): void {
    const projectFiles = [{ file: project.file, transcriptFile: project.file }];
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    const step = createFileStep(events, listInverseCommits(repoFolder, basename(project.file.toString()), true));
    stepFileAndWriteCommit(repoFolder, basename(project.file.toString()), step, undefined);
}

test("test_the_box_cannot_open_when_the_inverse_repo_folder_does_not_exist", (t) => {
    // Scenario: a project whose store holds no repo for the file, and a time the history spans.
    const project = writeUnwalkedProject(t);
    // opening is not allowed.
    assert.equal(canOpenViewFile(project.storeFolder, project.projectFolder, project.file, true), false);
});

test("test_the_box_cannot_open_when_the_time_is_not_spanned", (t) => {
    // Scenario: a project with a repo, and a time the history does not span.
    const project = writeUnwalkedProject(t);
    walkProject(project);
    // opening is not allowed.
    assert.equal(canOpenViewFile(project.storeFolder, project.projectFolder, project.file, false), false);
});

test("test_the_box_can_open_with_a_repo_and_a_spanned_time", (t) => {
    const project = writeUnwalkedProject(t);
    walkProject(project);
    assert.equal(canOpenViewFile(project.storeFolder, project.projectFolder, project.file, true), true);
});

test("test_a_time_older_than_now_is_read_as_it_is", () => {
    // Scenario: second 15, Now is second 20.
    assert.deepEqual(computeViewFileInstant(makeInstant(15), makeInstant(20), FAR_FUTURE_INSTANT), makeInstant(15));
});

test("test_the_time_now_is_read_at_the_current_instant", () => {
    // Scenario: the file time is Now (second 20).
    assert.deepEqual(computeViewFileInstant(makeInstant(20), makeInstant(20), FAR_FUTURE_INSTANT), FAR_FUTURE_INSTANT);
});

test("test_the_text_at_an_instant_after_disk_now_is_the_current_file_text", (t) => {
    // Scenario: the history of a.txt is walked; the disk text is "three".
    const project = writeUnwalkedProject(t);
    walkProject(project);
    // the text at the newest event time (Now for the viewer) is not stored.
    assert.equal(readFileTextAtInstant(project.storeFolder, project.projectFolder, project.file, makeInstant(20)), undefined);
    // the text at the instant the box reads for Now is the current file text.
    const nowInstant = computeViewFileInstant(makeInstant(20), makeInstant(20), FAR_FUTURE_INSTANT);
    assert.equal(readFileTextAtInstant(project.storeFolder, project.projectFolder, project.file, nowInstant), "three\n");
});

test("test_no_text_gives_no_lines", () => {
    assert.deepEqual(buildViewFileLines(undefined, new Path("/p/a.ts"), 40), []);
});

test("test_the_lines_of_a_text_are_numbered_and_colored_by_the_language_of_the_file", () => {
    // Scenario: a typescript text of two lines.
    const lines = buildViewFileLines("const x = 1;\nlet y;\n", new Path("/p/a.ts"), 40);
    // two numbered lines; the word const has a color.
    assert.deepEqual(lines.map((line) => line.lineNumber), [1, 2]);
    assert.notEqual(lines[0]!.pieces.find((piece) => piece.text === "const")!.color, undefined);
});

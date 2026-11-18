// The read-only version of the other-files walk: it reads repos that are walked to their end and writes nothing.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { buildOnDemandInverseReposForFiles, getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { readOtherFilesWalkedToTheEnd } from "../engineV3/engineV3_step_finished_other_files.ts";
import { walkOtherFilesToTheEnd, type WalkOtherFilesInput } from "../engineV3/engineV3_step_other_files.ts";
import { writeWalkCoverage } from "../engineV3/engineV3_walk_coverage.ts";
import { makeEditRows, makeWriteCreateRows, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const REPLAYED_FILE_NAME = "a.txt";
const OTHER_FILE_NAME = "b.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const NOT_WALKED_PATTERN = /the repo of b\.txt is not walked to its end/;

// a.txt is the replayed file; b.txt gets a Write at second 10 and an Edit at second 20.
function writeTwoFileProject(t: TestContext): ProjectWithFiles {
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "two\n"], [OTHER_FILE_NAME, "b1\n"]]);
    return writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a1", filePathByFileName.get(REPLAYED_FILE_NAME)!, "one", "two", "one\n", 15),
        ...makeWriteCreateRows(projectFolder, "toolu_b1", filePathByFileName.get(OTHER_FILE_NAME)!, "b0\n", 10),
        ...makeEditRows(projectFolder, "toolu_b2", filePathByFileName.get(OTHER_FILE_NAME)!, "b0", "b1", "b0\n", 20),
    ]);
}

function makeProjectFiles(project: ProjectWithFiles): ProjectFile[] {
    return [...project.fileByName.values()].map((file) => ({ file, transcriptFile: file }));
}

function makeInput(project: ProjectWithFiles): WalkOtherFilesInput {
    const replayFiles = makeProjectFiles(project);
    const replayedProjectFile = replayFiles.find((projectFile) => basename(projectFile.file.toString()) === REPLAYED_FILE_NAME)!;
    return { projectFolder: project.projectFolder, replayFiles, replayedProjectFile, storeFolder: project.storeFolder, transcriptsToParse: [project.jsonlsFolder], fileHistoryFolders: [project.snapshotFolder], reportProgress: () => {}, earliestBoundary: undefined };
}

function describeFolderTree(folder: string): string[] {
    const lines: string[] = [];
    for (const entryName of readdirSync(folder).sort()) {
        const entryPath = join(folder, entryName);
        const entryStat = lstatSync(entryPath);
        if (entryStat.isDirectory()) {
            lines.push(`dir ${entryPath} ${entryStat.mtimeMs}`);
            lines.push(...describeFolderTree(entryPath));
        } else {
            lines.push(`file ${entryPath} ${entryStat.mtimeMs} ${createHash("sha256").update(readFileSync(entryPath)).digest("hex")}`);
        }
    }
    return lines;
}

function getOtherRepoFolder(project: ProjectWithFiles) {
    return getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileByName.get(OTHER_FILE_NAME)!);
}

test("test_readOtherFilesWalkedToTheEnd_refuses_when_the_repo_of_an_other_file_is_missing", (t) => {
    // Scenario: the store folder exists and holds no repo.
    const project = writeTwoFileProject(t);
    mkdirSync(project.storeFolder.toString(), { recursive: true });
    const treeBefore = describeFolderTree(project.storeFolder.toString());
    // The read runs.
    const others = readOtherFilesWalkedToTheEnd(makeInput(project));
    // It refuses with a reason that names b.txt, returns no walked file, and writes nothing.
    assert.match(String(others.refusalReason), NOT_WALKED_PATTERN);
    assert.deepEqual(others.walkedFiles, []);
    assert.deepEqual(describeFolderTree(project.storeFolder.toString()), treeBefore);
});

test("test_readOtherFilesWalkedToTheEnd_refuses_when_the_repo_has_no_finished_coverage", (t) => {
    // Scenario: b.txt has a repo with only the disk-now commit and a coverage that says not finished.
    const project = writeTwoFileProject(t);
    mkdirSync(project.storeFolder.toString(), { recursive: true });
    buildOnDemandInverseReposForFiles(project.projectFolder, [{ file: project.fileByName.get(OTHER_FILE_NAME)!, transcriptFile: project.fileByName.get(OTHER_FILE_NAME)! }], [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    writeWalkCoverage(getOtherRepoFolder(project), OTHER_FILE_NAME, false);
    const treeBefore = describeFolderTree(project.storeFolder.toString());
    // The read runs.
    const others = readOtherFilesWalkedToTheEnd(makeInput(project));
    // It refuses, and the store tree is equal to before.
    assert.match(String(others.refusalReason), NOT_WALKED_PATTERN);
    assert.deepEqual(describeFolderTree(project.storeFolder.toString()), treeBefore);
});

test("test_readOtherFilesWalkedToTheEnd_returns_the_commits_the_old_walk_returned", (t) => {
    // Scenario: the old walk brings b.txt to its end, and the coverage of b.txt is marked finished.
    const project = writeTwoFileProject(t);
    mkdirSync(project.storeFolder.toString(), { recursive: true });
    const oldWalkedFiles = walkOtherFilesToTheEnd(makeInput(project));
    writeWalkCoverage(getOtherRepoFolder(project), OTHER_FILE_NAME, true);
    const treeBefore = describeFolderTree(project.storeFolder.toString());
    // The read runs.
    const others = readOtherFilesWalkedToTheEnd(makeInput(project));
    // It has no refusal, the same commit list as the old walk, and it wrote nothing.
    assert.equal(others.refusalReason, undefined);
    assert.equal(others.walkedFiles.length, 1);
    assert.equal(others.walkedFiles[0]!.file.equals(oldWalkedFiles[0]!.file), true);
    assert.deepEqual(others.walkedFiles[0]!.commits, oldWalkedFiles[0]!.commits);
    assert.deepEqual(describeFolderTree(project.storeFolder.toString()), treeBefore);
});

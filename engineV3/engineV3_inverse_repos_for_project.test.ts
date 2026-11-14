import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { getAllEventsForFileFrom, sortEventsNewestToOldest, FileEventType } from "./engineV3_replay_reverse_events.ts";
import { StateConfidence, listKnownStatesForFile, type FileKnownState } from "./engineV3_file_known_states.ts";
import { buildInverseRepoByEventKind, listInverseCommits } from "./engineV3_inverse_repo.ts";
import {
    buildInverseReposForFiles, getInverseRepoFolderForFile, readInverseReposSettingsFromArguments,
    type FileInverseRepoResult, type ProjectFile,
} from "./engineV3_inverse_repos_for_project.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-inverse-repos-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEditRows(toolUseId: string, filePath: string, oldString: string, newString: string, originalFile: string, second: number): object[] {
    const toolUseResult = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false, originalFile };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: filePath }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

function runGit(folder: string, args: string[], second: number): void {
    const commitDate = makeInstant(second).toISOString();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: folder, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, stdio: "pipe" });
}

type Project = { projectFolder: Path; jsonlsFolder: Path; snapshotFolder: Path; storeFolder: Path; fileA: Path; fileB: Path };

// A git project holding a.txt and sub/b.txt, each committed once and edited once after; one transcript names both edits.
function makeProject(t: TestContext): Project {
    const rootFolder = makeTempFolder(t);
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const snapshotFolder = join(rootFolder, "file-history");
    mkdirSync(join(projectFolder, "sub"), { recursive: true });
    mkdirSync(jsonlsFolder);
    mkdirSync(snapshotFolder);
    runGit(projectFolder, ["init", "-q"], 0);
    writeFileSync(join(projectFolder, "a.txt"), "one\n");
    writeFileSync(join(projectFolder, "sub", "b.txt"), "red\n");
    runGit(projectFolder, ["add", "a.txt", "sub/b.txt"], 5);
    runGit(projectFolder, ["commit", "-q", "-m", "first"], 5);
    writeFileSync(join(projectFolder, "a.txt"), "two\n");
    writeFileSync(join(projectFolder, "sub", "b.txt"), "blue\n");
    const fileA = new Path(join(projectFolder, "a.txt"));
    const fileB = new Path(join(projectFolder, "sub", "b.txt"));
    const records = [
        ...makeEditRows("toolu_a", fileA.toString(), "one", "two", "one\n", 20),
        ...makeEditRows("toolu_b", fileB.toString(), "red", "blue", "red\n", 30),
    ];
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return { projectFolder: new Path(projectFolder), jsonlsFolder: new Path(jsonlsFolder), snapshotFolder: new Path(snapshotFolder), storeFolder: new Path(join(rootFolder, "store")), fileA, fileB };
}

function buildProject(project: Project, reportProgress: (event: ProgressEvent) => void = () => {}): FileInverseRepoResult[] {
    const projectFiles = [project.fileA, project.fileB].map((file) => ({ file, transcriptFile: file }));
    return buildInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], [project.snapshotFolder], project.storeFolder, DISK_NOW_INSTANT, reportProgress);
}

const TRANSCRIPT_ROOT = "/transcript-root";

// The same project, but the logs name the files under TRANSCRIPT_ROOT instead of their path on disk.
function makeProjectWhoseLogsNameOtherRoot(t: TestContext): { project: Project; projectFiles: ProjectFile[] } {
    const project = makeProject(t);
    const transcriptFileA = new Path(join(TRANSCRIPT_ROOT, "a.txt"));
    const transcriptFileB = new Path(join(TRANSCRIPT_ROOT, "sub", "b.txt"));
    const records = [
        ...makeEditRows("toolu_a", transcriptFileA.toString(), "one", "two", "one\n", 20),
        ...makeEditRows("toolu_b", transcriptFileB.toString(), "red", "blue", "red\n", 30),
    ];
    writeFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    const projectFiles = [{ file: project.fileA, transcriptFile: transcriptFileA }, { file: project.fileB, transcriptFile: transcriptFileB }];
    return { project, projectFiles };
}

function buildWithProjectFiles(project: Project, projectFiles: ProjectFile[], storeFolder: Path): FileInverseRepoResult[] {
    return buildInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], [project.snapshotFolder], storeFolder, DISK_NOW_INSTANT, () => {});
}

type SingleFileBuild = { eventCount: number; states: FileKnownState[] };

// The path the project function must agree with: one file, its own transcript read.
function buildWithSingleFilePath(project: Project, file: Path, repoFolder: Path): SingleFileBuild {
    const events = sortEventsNewestToOldest(getAllEventsForFileFrom(file, file, [project.jsonlsFolder], [project.snapshotFolder]));
    const states = listKnownStatesForFile(events);
    mkdirSync(repoFolder.toString(), { recursive: true });
    buildInverseRepoByEventKind(repoFolder, basename(file.toString()), states, DISK_NOW_INSTANT);
    return { eventCount: events.length, states };
}

function summarizeCommits(repoFolder: Path, fileName: string): object[] {
    return listInverseCommits(repoFolder, fileName).map((commit) => ({ eventType: commit.eventType, moment: commit.moment, confidence: commit.confidence, text: commit.text }));
}

test("test_each_file_of_the_project_gets_a_repo_whose_first_commit_is_the_disk_text", (t) => {
    // Scenario: every file of the project gets its own inverse repo, newest commit first.
    // A project has two files with different text on disk.
    const project = makeProject(t);
    // The inverse repos are built for both files.
    buildProject(project);
    // The first commit of each repo is the disk-now commit holding the text on disk.
    const commitsOfA = listInverseCommits(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA), "a.txt");
    assert.equal(commitsOfA[0]!.eventType, FileEventType.DiskNow);
    assert.equal(commitsOfA[0]!.text, "two\n");
    const commitsOfB = listInverseCommits(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileB), "b.txt");
    assert.equal(commitsOfB[0]!.eventType, FileEventType.DiskNow);
    assert.equal(commitsOfB[0]!.text, "blue\n");
});

test("test_a_file_in_a_sub_folder_gets_its_repo_under_the_same_sub_folder_in_the_store", (t) => {
    // Scenario: the store keeps the sub-folders of the project.
    // A project has the file sub/b.txt.
    const project = makeProject(t);
    // The repo folder for that file is asked for.
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileB);
    // It is the store folder plus the project-relative path plus ".git".
    assert.equal(repoFolder.toString(), join(project.storeFolder.toString(), "sub", "b.txt.git"));
    // After the build, that folder holds a readable repo.
    buildProject(project);
    assert.equal(listInverseCommits(repoFolder, "b.txt")[0]!.text, "blue\n");
});

test("test_the_result_of_each_file_equals_the_counts_of_the_single_file_path", (t) => {
    // Scenario: the project function counts the same events and states as the single-file path.
    // A project has two files.
    const project = makeProject(t);
    // The project function builds both repos.
    const results = buildProject(project);
    // Each result names its file and repo folder.
    assert.deepEqual(results.map((result) => result.file), [project.fileA, project.fileB]);
    assert.deepEqual(results.map((result) => result.repoFolder), [project.fileA, project.fileB].map((file) => getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, file)));
    // The single-file path gives the expected counts for each file.
    const otherStoreFolder = new Path(join(makeTempFolder(t), "other-store"));
    for (const [index, file] of [project.fileA, project.fileB].entries()) {
        const single = buildWithSingleFilePath(project, file, getInverseRepoFolderForFile(otherStoreFolder, project.projectFolder, file));
        const unknownStateCount = single.states.filter((state) => state.confidence === StateConfidence.Unknown).length;
        assert.equal(results[index]!.eventCount, single.eventCount);
        assert.equal(results[index]!.stateCount, single.states.length);
        assert.equal(results[index]!.commitCount, single.states.length - unknownStateCount);
        assert.equal(results[index]!.unknownStateCount, unknownStateCount);
    }
});

test("test_the_commit_list_of_each_file_equals_the_commit_list_of_the_single_file_path", (t) => {
    // Scenario: the project function writes the same commits as the single-file path.
    // A project has two files.
    const project = makeProject(t);
    // The project function builds both repos into the store.
    buildProject(project);
    // The single-file path builds the same files into another folder.
    const otherStoreFolder = new Path(join(makeTempFolder(t), "other-store"));
    for (const file of [project.fileA, project.fileB]) {
        const otherRepoFolder = getInverseRepoFolderForFile(otherStoreFolder, project.projectFolder, file);
        buildWithSingleFilePath(project, file, otherRepoFolder);
        // The commits of both repos agree in event type, moment, confidence and text.
        const fileName = basename(file.toString());
        const projectRepoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, file);
        const projectCommits = summarizeCommits(projectRepoFolder, fileName);
        assert.ok(projectCommits.length > 1);
        assert.deepEqual(projectCommits, summarizeCommits(otherRepoFolder, fileName));
    }
});

test("test_progress_is_reported_once_per_file_with_current_counting_up_to_total", (t) => {
    // Scenario: the caller sees one progress event per finished file.
    // A project has two files and a progress sink collects the events.
    const project = makeProject(t);
    const events: ProgressEvent[] = [];
    // The project function builds both repos.
    buildProject(project, (event) => events.push(event));
    // There is one event per file, in file order, counting 1..2 of 2.
    assert.deepEqual(events.map((event) => [event.current, event.total]), [[1, 2], [2, 2]]);
    assert.ok(events.every((event) => event.kind === DocumentResponseKind.progress));
    // Each label starts with the project-relative path of its file.
    assert.ok(events[0]!.label.startsWith("a.txt"));
    assert.ok(events[1]!.label.startsWith(join("sub", "b.txt")));
});

test("test_an_existing_repo_folder_throws_with_the_folder_in_the_message", (t) => {
    // Scenario: a repo folder that is already there is never overwritten.
    // A project is set and the repo folder of a.txt already exists.
    const project = makeProject(t);
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA);
    mkdirSync(repoFolder.toString(), { recursive: true });
    // The build throws and the message holds that folder.
    assert.throws(() => buildProject(project), (error: Error) => error.message.includes(repoFolder.toString()));
});

test("test_a_file_outside_the_project_folder_throws", (t) => {
    // Scenario: a file that is not in the project has no place in the store.
    // A project is set and another file lies beside the project folder.
    const project = makeProject(t);
    const outsideFile = new Path(join(makeTempFolder(t), "outside.txt"));
    // Asking for the repo folder of that file throws.
    assert.throws(() => getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, outsideFile), /outside/);
});

test("test_the_write_and_edit_events_are_found_when_the_logs_name_the_files_under_another_root", (t) => {
    // Scenario: the logs name each file by a path that differs from its path on disk.
    // A project has logs that name its files under another root.
    const { project, projectFiles } = makeProjectWhoseLogsNameOtherRoot(t);
    // The build uses the transcript path of each file.
    const results = buildWithProjectFiles(project, projectFiles, project.storeFolder);
    // The same build with the transcript path set equal to the disk path finds fewer events.
    const sameRootFiles = projectFiles.map((projectFile) => ({ file: projectFile.file, transcriptFile: projectFile.file }));
    const sameRootResults = buildWithProjectFiles(project, sameRootFiles, new Path(join(makeTempFolder(t), "other-store")));
    for (const [index, result] of results.entries()) {
        assert.ok(result.eventCount > sameRootResults[index]!.eventCount);
    }
});

test("test_the_first_commit_is_the_text_on_disk_when_the_logs_name_the_files_under_another_root", (t) => {
    // Scenario: the disk text stays the newest state even when the log paths differ.
    // A project has logs that name its files under another root.
    const { project, projectFiles } = makeProjectWhoseLogsNameOtherRoot(t);
    // The build uses the transcript path of each file.
    buildWithProjectFiles(project, projectFiles, project.storeFolder);
    // The first commit of each repo holds the text of the file on disk.
    const commitsOfA = listInverseCommits(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA), "a.txt");
    assert.equal(commitsOfA[0]!.eventType, FileEventType.DiskNow);
    assert.equal(commitsOfA[0]!.text, "two\n");
});

test("test_the_repo_folder_follows_the_disk_path_when_the_logs_name_the_files_under_another_root", (t) => {
    // Scenario: the store keeps the disk-relative path, not the transcript path.
    // A project has logs that name its files under another root.
    const { project, projectFiles } = makeProjectWhoseLogsNameOtherRoot(t);
    // The build uses the transcript path of each file.
    const results = buildWithProjectFiles(project, projectFiles, project.storeFolder);
    // The repo folder of sub/b.txt is the store folder plus the disk-relative path plus ".git".
    assert.equal(results[1]!.repoFolder.toString(), join(project.storeFolder.toString(), "sub", "b.txt.git"));
});

test("test_a_project_with_no_git_gets_one_disk_now_commit_per_file", (t) => {
    // Scenario: a folder that is not a git repo has no git commits, so each repo holds only the disk text.
    // A project folder is outside any git repo and holds two files.
    const rootFolder = makeTempFolder(t);
    const projectFolder = join(rootFolder, "project");
    mkdirSync(join(projectFolder, "sub"), { recursive: true });
    mkdirSync(join(rootFolder, "jsonls"));
    mkdirSync(join(rootFolder, "file-history"));
    writeFileSync(join(projectFolder, "a.txt"), "two\n");
    writeFileSync(join(projectFolder, "sub", "b.txt"), "blue\n");
    const fileA = new Path(join(projectFolder, "a.txt"));
    const fileB = new Path(join(projectFolder, "sub", "b.txt"));
    const storeFolder = new Path(join(rootFolder, "store"));
    // The build runs and does not throw.
    const projectFiles = [fileA, fileB].map((file) => ({ file, transcriptFile: file }));
    buildInverseReposForFiles(new Path(projectFolder), projectFiles, [new Path(join(rootFolder, "jsonls"))], [new Path(join(rootFolder, "file-history"))], storeFolder, DISK_NOW_INSTANT, () => {});
    // Each repo holds exactly one commit: the disk-now commit.
    const commitsOfA = listInverseCommits(getInverseRepoFolderForFile(storeFolder, new Path(projectFolder), fileA), "a.txt");
    assert.equal(commitsOfA.length, 1);
    assert.equal(commitsOfA[0]!.eventType, FileEventType.DiskNow);
    const commitsOfB = listInverseCommits(getInverseRepoFolderForFile(storeFolder, new Path(projectFolder), fileB), "b.txt");
    assert.equal(commitsOfB.length, 1);
    assert.equal(commitsOfB[0]!.eventType, FileEventType.DiskNow);
});

test("test_the_argument_parser_returns_the_four_folders", () => {
    // Scenario: the command line holds the four folders.
    // The four flags are given in any order.
    const settings = readInverseReposSettingsFromArguments(["--store", "/s", "--project", "/p", "--file-history", "/h", "--jsonls", "/j"]);
    // The settings hold each folder as a Path.
    assert.deepEqual(settings, { projectFolder: new Path("/p"), jsonlsFolder: new Path("/j"), fileHistoryFolder: new Path("/h"), storeFolder: new Path("/s") });
});

test("test_the_argument_parser_throws_when_a_folder_is_missing", () => {
    // Scenario: a missing flag is a usage error.
    // The command line lacks --store.
    const argumentList = ["--project", "/p", "--jsonls", "/j", "--file-history", "/h"];
    // The parser throws the usage text.
    assert.throws(() => readInverseReposSettingsFromArguments(argumentList), /usage/);
});

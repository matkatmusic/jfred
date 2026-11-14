import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import { getAllEventsForFileFrom, sortEventsNewestToOldest, FileEventType } from "./engineV3_replay_reverse_events.ts";
import { StateConfidence, listKnownStatesForFile, type FileKnownState } from "./engineV3_file_known_states.ts";
import { buildInverseRepoByEventKind, listInverseCommits } from "./engineV3_inverse_repo.ts";
import {
    INVERSE_REPO_FORMAT_VERSION, buildInverseReposForFiles, getInverseRepoFolderForFile, readInverseReposSettingsFromArguments,
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
    // The per-file events are the ones that count files; step events leave current and total unset.
    const fileEvents = events.filter((event) => event.current !== undefined);
    // There is one event per file, in file order, counting 1..2 of 2.
    assert.deepEqual(fileEvents.map((event) => [event.current, event.total]), [[1, 2], [2, 2]]);
    assert.ok(events.every((event) => event.kind === DocumentResponseKind.progress));
    // Each label starts with the project-relative path of its file.
    assert.ok(fileEvents[0]!.label.startsWith("a.txt"));
    assert.ok(fileEvents[1]!.label.startsWith(join("sub", "b.txt")));
});

test("test_a_built_file_sends_one_step_event_per_commit_with_rising_done_and_fixed_total", (t) => {
    // Scenario: while a.txt is built, each commit written into its repo is reported as one step.
    // A project has two files and a progress sink collects the events.
    const project = makeProject(t);
    const events: ProgressEvent[] = [];
    // The project function builds both repos.
    const results = buildProject(project, (event) => events.push(event));
    // The step events of a.txt leave current and total unset.
    const stepEvents = events.filter((event) => event.file === "a.txt" && event.current === undefined);
    // There is one step event per commit of a.txt.
    assert.equal(stepEvents.length, results[0]!.commitCount);
    // The steps done rise 1, 2, 3 and so on.
    assert.deepEqual(stepEvents.map((event) => event.fileStepsDone), stepEvents.map((_event, index) => index + 1));
    // The steps total is the commit count in every step event.
    assert.ok(stepEvents.every((event) => event.fileStepsTotal === results[0]!.commitCount));
    assert.ok(stepEvents.every((event) => event.total === undefined));
});

test("test_the_last_event_of_a_file_has_steps_done_equal_to_steps_total", (t) => {
    // Scenario: the finished-file event of a.txt shows the bar full.
    // A project has two files and a progress sink collects the events.
    const project = makeProject(t);
    const events: ProgressEvent[] = [];
    // The project function builds both repos.
    const results = buildProject(project, (event) => events.push(event));
    // The last event of a.txt is its per-file event.
    const eventsOfA = events.filter((event) => event.file === "a.txt");
    const lastEventOfA = eventsOfA[eventsOfA.length - 1]!;
    assert.equal(lastEventOfA.current, 1);
    // Its steps done equal its steps total, which is the commit count.
    assert.equal(lastEventOfA.fileStepsDone, lastEventOfA.fileStepsTotal);
    assert.equal(lastEventOfA.fileStepsTotal, results[0]!.commitCount);
});

test("test_every_event_of_a_file_carries_its_project_relative_path_with_forward_slashes", (t) => {
    // Scenario: the web page finds the bar of a file by the file field of each event.
    // A project has a.txt and sub/b.txt and a progress sink collects the events.
    const project = makeProject(t);
    const events: ProgressEvent[] = [];
    // The project function builds both repos.
    buildProject(project, (event) => events.push(event));
    // Every event carries the file field, and it is one of the two paths.
    assert.ok(events.every((event) => event.file === "a.txt" || event.file === "sub/b.txt"));
    // Both files are in the events.
    assert.ok(events.some((event) => event.file === "sub/b.txt"));
});

test("test_a_reused_file_sends_exactly_one_event_with_steps_done_equal_to_its_commit_count", (t) => {
    // Scenario: a file whose repo is reused does no work, so it reports one event.
    // A project is built one time.
    const project = makeProject(t);
    const firstResults = buildProject(project);
    // The second call reuses both repos and a progress sink collects the events.
    const events: ProgressEvent[] = [];
    buildProject(project, (event) => events.push(event));
    // There is exactly one event per file.
    assert.equal(events.length, 2);
    // The event of a.txt holds the file, the file count and the stored commit count as done and total.
    assert.equal(events[0]!.file, "a.txt");
    assert.equal(events[0]!.current, 1);
    assert.equal(events[0]!.fileStepsDone, firstResults[0]!.commitCount);
    assert.equal(events[0]!.fileStepsTotal, firstResults[0]!.commitCount);
});

// An existing repo folder no longer throws: without a stamp it is rebuilt.
// test("test_an_existing_repo_folder_throws_with_the_folder_in_the_message", (t) => {
//     // Scenario: a repo folder that is already there is never overwritten.
//     // A project is set and the repo folder of a.txt already exists.
//     const project = makeProject(t);
//     const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA);
//     mkdirSync(repoFolder.toString(), { recursive: true });
//     // The build throws and the message holds that folder.
//     assert.throws(() => buildProject(project), (error: Error) => error.message.includes(repoFolder.toString()));
// });

test("test_a_first_call_returns_was_reused_false", (t) => {
    // Scenario: a repo that is built now was not reused.
    // A project has two files and no store yet.
    const project = makeProject(t);
    // The first call builds both repos.
    const results = buildProject(project);
    // Every result says wasReused is false.
    assert.deepEqual(results.map((result) => result.wasReused), [false, false]);
});

test("test_a_second_call_with_the_same_inputs_returns_was_reused_true_and_keeps_the_commit_hashes", (t) => {
    // Scenario: the same inputs a second time do no work.
    // A project is built one time and the commit hashes of a.txt are noted.
    const project = makeProject(t);
    buildProject(project);
    const repoFolderOfA = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA);
    const commitHashesBefore = listInverseCommits(repoFolderOfA, "a.txt").map((commit) => commit.commitHash.toString());
    // The second call runs with the same files and the same logs.
    const results = buildProject(project);
    // Every result says wasReused is true and the counts are the counts of the first call.
    assert.deepEqual(results.map((result) => result.wasReused), [true, true]);
    assert.equal(results[0]!.commitCount, commitHashesBefore.length);
    // The commit hashes of a.txt are the same.
    const commitHashesAfter = listInverseCommits(repoFolderOfA, "a.txt").map((commit) => commit.commitHash.toString());
    assert.deepEqual(commitHashesAfter, commitHashesBefore);
});

test("test_a_change_of_the_file_on_disk_makes_was_reused_false_and_the_first_commit_holds_the_new_bytes", (t) => {
    // Scenario: new bytes on disk make the stamp differ.
    // A project is built one time.
    const project = makeProject(t);
    buildProject(project);
    // The text of a.txt on disk changes.
    writeFileSync(project.fileA.toString(), "three\n");
    // The second call rebuilds a.txt.
    const results = buildProject(project);
    assert.equal(results[0]!.wasReused, false);
    // The first commit of a.txt holds the new bytes.
    const commitsOfA = listInverseCommits(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA), "a.txt");
    assert.equal(commitsOfA[0]!.text, "three\n");
});

test("test_a_new_log_line_that_names_the_file_makes_was_reused_false", (t) => {
    // Scenario: a new log line makes the stamp differ.
    // A project is built one time.
    const project = makeProject(t);
    buildProject(project);
    // One new log line names a.txt.
    const newRows = makeEditRows("toolu_a0", project.fileA.toString(), "zero", "one", "zero\n", 10);
    appendFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), newRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    // The second call rebuilds a.txt.
    const results = buildProject(project);
    assert.equal(results[0]!.wasReused, false);
});

test("test_a_repo_whose_stamp_has_no_format_version_is_rebuilt", (t) => {
    // Scenario: a repo built before the format version existed is built again.
    // A project is built one time and the stamp of a.txt is noted.
    const project = makeProject(t);
    buildProject(project);
    const stampPathOfA = join(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA).toString(), "jfred-stamp.json");
    // The stamp of a.txt loses its format version, like a stamp written by the old code.
    const stampOfA = JSON.parse(readFileSync(stampPathOfA, "utf8"));
    delete stampOfA.inputs.formatVersion;
    writeFileSync(stampPathOfA, JSON.stringify(stampOfA));
    // The second call rebuilds a.txt and reuses b.txt.
    const results = buildProject(project);
    assert.deepEqual(results.map((result) => result.wasReused), [false, true]);
    // The new stamp of a.txt holds the current format version.
    assert.equal(JSON.parse(readFileSync(stampPathOfA, "utf8")).inputs.formatVersion, INVERSE_REPO_FORMAT_VERSION);
});

test("test_a_repo_whose_stamp_has_the_current_format_version_is_reused", (t) => {
    // Scenario: a repo built with the current format version is not built again.
    // A project is built one time and the commit hashes of a.txt are noted.
    const project = makeProject(t);
    buildProject(project);
    const repoFolderOfA = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileA);
    // The stamp of a.txt holds the current format version.
    const stampOfA = JSON.parse(readFileSync(join(repoFolderOfA.toString(), "jfred-stamp.json"), "utf8"));
    assert.equal(stampOfA.inputs.formatVersion, INVERSE_REPO_FORMAT_VERSION);
    const commitHashesBefore = listInverseCommits(repoFolderOfA, "a.txt").map((commit) => commit.commitHash.toString());
    // The second call reuses both repos and the commit hashes of a.txt are the same.
    const results = buildProject(project);
    assert.deepEqual(results.map((result) => result.wasReused), [true, true]);
    assert.deepEqual(listInverseCommits(repoFolderOfA, "a.txt").map((commit) => commit.commitHash.toString()), commitHashesBefore);
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

type CopyScene = { projectFolder: Path; jsonlsFolder: Path; snapshotFolder: Path; storeFolder: Path };

function makeCallRecord(toolName: string, toolUseId: string, input: object, second: number, cwd: string): object {
    const content = [{ type: "tool_use", id: toolUseId, name: toolName, input, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), cwd, message: { role: "assistant", content } };
}

function makeWriteCreateRows(toolUseId: string, filePath: string, content: string, second: number, cwd: string): object[] {
    const toolUseResult = { type: "create", filePath, content, originalFile: null, structuredPatch: [], userModified: false };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath }, second, cwd), resultRecord];
}

function makeCopyRows(toolUseId: string, sourceFile: Path, destinationFile: Path, second: number, cwd: string): object[] {
    return [makeCallRecord("Bash", toolUseId, { command: `cp ${sourceFile.toString()} ${destinationFile.toString()}` }, second, cwd)];
}

// A project folder that holds the named files with the given text on disk, no git, and one transcript with the given records.
function makeCopyScene(t: TestContext, diskTextByFileName: Record<string, string>, makeRecords: (projectFolder: Path) => object[]): CopyScene {
    const rootFolder = makeTempFolder(t);
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const snapshotFolder = join(rootFolder, "file-history");
    mkdirSync(projectFolder);
    mkdirSync(jsonlsFolder);
    mkdirSync(snapshotFolder);
    for (const [fileName, diskText] of Object.entries(diskTextByFileName)) {
        writeFileSync(join(projectFolder, fileName), diskText);
    }
    const records = makeRecords(new Path(projectFolder));
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return { projectFolder: new Path(projectFolder), jsonlsFolder: new Path(jsonlsFolder), snapshotFolder: new Path(snapshotFolder), storeFolder: new Path(join(rootFolder, "store")) };
}

function buildCopyScene(scene: CopyScene, fileNames: string[]): FileInverseRepoResult[] {
    const projectFiles = fileNames.map((fileName) => {
        const file = new Path(join(scene.projectFolder.toString(), fileName));
        return { file, transcriptFile: file };
    });
    return buildInverseReposForFiles(scene.projectFolder, projectFiles, [scene.jsonlsFolder], [scene.snapshotFolder], scene.storeFolder, DISK_NOW_INSTANT, () => {});
}

function listCommitsOfCopySceneFile(scene: CopyScene, fileName: string) {
    const file = new Path(join(scene.projectFolder.toString(), fileName));
    return listInverseCommits(getInverseRepoFolderForFile(scene.storeFolder, scene.projectFolder, file), fileName);
}

function makeCopyOfAIntoBRecords(projectFolder: Path): object[] {
    const fileA = new Path(join(projectFolder.toString(), "a.py"));
    const fileB = new Path(join(projectFolder.toString(), "b.py"));
    return [
        ...makeWriteCreateRows("w1", fileA.toString(), "A1", 1, projectFolder.toString()),
        ...makeCopyRows("c1", fileA, fileB, 2, projectFolder.toString()),
    ];
}

function makeChainRecords(projectFolder: Path): object[] {
    const fileA = new Path(join(projectFolder.toString(), "a.py"));
    const fileB = new Path(join(projectFolder.toString(), "b.py"));
    const fileC = new Path(join(projectFolder.toString(), "c.py"));
    return [
        ...makeCopyOfAIntoBRecords(projectFolder),
        ...makeCopyRows("c2", fileB, fileC, 3, projectFolder.toString()),
    ];
}

test("test_a_file_born_by_a_copy_gets_the_text_of_its_source_as_born_text", (t) => {
    // Scenario: a.py holds "A1", then `cp a.py b.py` runs; b.py holds other text on disk now.
    const scene = makeCopyScene(t, { "a.py": "A1", "b.py": "B-now" }, makeCopyOfAIntoBRecords);
    // Both files are project files.
    buildCopyScene(scene, ["b.py", "a.py"]);
    // The repo of b.py has a commit with the text of a.py before the copy, and a commit that says b.py was absent.
    const commitsOfB = listCommitsOfCopySceneFile(scene, "b.py");
    assert.ok(commitsOfB.some((commit) => commit.text === "A1"));
    assert.ok(commitsOfB.some((commit) => commit.isFileAbsent));
});

test("test_a_file_born_by_a_copy_gets_no_born_text_when_the_source_is_not_a_project_file", (t) => {
    // Scenario: the same copy, but only b.py is a project file.
    const scene = makeCopyScene(t, { "a.py": "A1", "b.py": "B-now" }, makeCopyOfAIntoBRecords);
    // The build runs for b.py alone and does not throw.
    buildCopyScene(scene, ["b.py"]);
    // The repo of b.py has no commit with the text of a.py, and still has the absent commit.
    const commitsOfB = listCommitsOfCopySceneFile(scene, "b.py");
    assert.ok(!commitsOfB.some((commit) => commit.text === "A1"));
    assert.ok(commitsOfB.some((commit) => commit.isFileAbsent));
});

test("test_a_chain_of_copies_gives_the_last_file_the_text_of_the_first_when_the_born_file_is_listed_before_its_source", (t) => {
    // Scenario: a.py holds "A1"; `cp a.py b.py` runs; then `cp b.py c.py` runs.
    const scene = makeCopyScene(t, { "a.py": "A1", "b.py": "B-now", "c.py": "C-now" }, makeChainRecords);
    // The project files are listed with each born file before its source.
    buildCopyScene(scene, ["c.py", "b.py", "a.py"]);
    // The repo of c.py has a commit with the text "A1".
    const commitsOfC = listCommitsOfCopySceneFile(scene, "c.py");
    assert.ok(commitsOfC.some((commit) => commit.text === "A1"));
});

test("test_a_file_born_by_a_copy_gets_no_born_text_when_the_source_text_before_the_copy_is_not_known", (t) => {
    // Scenario: `cp a.py b.py` runs, but no event of a.py is older than the copy.
    const scene = makeCopyScene(t, { "a.py": "A-now", "b.py": "B-now" }, (projectFolder) => {
        const fileA = new Path(join(projectFolder.toString(), "a.py"));
        const fileB = new Path(join(projectFolder.toString(), "b.py"));
        return makeCopyRows("c1", fileA, fileB, 2, projectFolder.toString());
    });
    // The build runs and does not throw.
    buildCopyScene(scene, ["b.py", "a.py"]);
    // Every commit of b.py holds either its disk text or no text.
    const commitsOfB = listCommitsOfCopySceneFile(scene, "b.py");
    assert.ok(commitsOfB.every((commit) => commit.text === undefined || commit.text === "B-now"));
});

test("test_a_file_that_is_gone_now_gets_a_repo_whose_first_commit_says_the_file_is_absent", (t) => {
    // Scenario: the logs write a.py with "A1" and then remove it; a.py is not on disk now.
    const scene = makeCopyScene(t, {}, (projectFolder) => {
        const fileA = join(projectFolder.toString(), "a.py");
        return [
            ...makeWriteCreateRows("w1", fileA, "A1", 1, projectFolder.toString()),
            makeCallRecord("Bash", "r1", { command: `rm ${fileA}` }, 3, projectFolder.toString()),
        ];
    });
    // The build runs for the gone file and does not throw.
    buildCopyScene(scene, ["a.py"]);
    // The first commit says the file is absent, and a later commit holds the text "A1".
    const commitsOfA = listCommitsOfCopySceneFile(scene, "a.py");
    assert.equal(commitsOfA[0]!.isFileAbsent, true);
    assert.ok(commitsOfA.some((commit) => commit.text === "A1"));
});

test("test_the_results_keep_the_order_of_the_project_files_when_a_born_file_is_listed_before_its_source", (t) => {
    // Scenario: a chain of copies, with the project files listed born file first.
    const scene = makeCopyScene(t, { "a.py": "A1", "b.py": "B-now", "c.py": "C-now" }, makeChainRecords);
    const fileNames = ["c.py", "b.py", "a.py"];
    // The build runs.
    const results = buildCopyScene(scene, fileNames);
    // Result i names project file i.
    for (const [index, fileName] of fileNames.entries()) {
        assert.equal(results[index]!.file.toString(), join(scene.projectFolder.toString(), fileName));
    }
});

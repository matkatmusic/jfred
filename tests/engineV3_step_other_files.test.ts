// The walker gives the other replay-list files a finished commit list and leaves the replayed file alone.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { DocumentResponseKind } from "../src/structures/vocabulary_views.ts";
import type { ProgressEvent } from "../src/parse/loadTranscript.ts";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { StateConfidence } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { createInverseRepo, insertStatesIntoInverseRepo, listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { selectInverseCommitAtInstant } from "../engineV3/engineV3_inverse_repo_read.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { walkOtherFilesToTheEnd, type WalkedOtherFile } from "../engineV3/engineV3_step_other_files.ts";
import { readEarliestBoundary, type EarliestBoundary } from "../engineV3/engineV3_earliest_boundary.ts";
import { Uuid } from "../src/structures/domain.ts";
import { commitFileAtSecond, makeBashRows, makeEditRows, makeInstant, makeWriteCreateRows, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const REPLAYED_FILE_NAME = "a.txt";
const STAMP_FILE_NAME = "jfred-stamp.json";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function makeProjectFiles(project: ProjectWithFiles): ProjectFile[] {
    return [...project.fileByName.values()].map((file) => ({ file, transcriptFile: file }));
}

function findProjectFileByName(projectFiles: ProjectFile[], fileName: string): ProjectFile {
    return projectFiles.find((projectFile) => basename(projectFile.file.toString()) === fileName)!;
}

function walkProject(project: ProjectWithFiles, reportProgress: (event: ProgressEvent) => void = () => {}, earliestBoundary: EarliestBoundary | undefined = undefined): WalkedOtherFile[] {
    const replayFiles = makeProjectFiles(project);
    mkdirSync(project.storeFolder.toString(), { recursive: true });
    // return walkOtherFilesToTheEnd({ projectFolder: project.projectFolder, replayFiles, replayedProjectFile: findProjectFileByName(replayFiles, REPLAYED_FILE_NAME), storeFolder: project.storeFolder, transcriptsToParse: [project.jsonlsFolder], fileHistoryFolders: [project.snapshotFolder], reportProgress });
    return walkOtherFilesToTheEnd({ projectFolder: project.projectFolder, replayFiles, replayedProjectFile: findProjectFileByName(replayFiles, REPLAYED_FILE_NAME), storeFolder: project.storeFolder, transcriptsToParse: [project.jsonlsFolder], fileHistoryFolders: [project.snapshotFolder], reportProgress, earliestBoundary });
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
            const fileHash = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
            lines.push(`file ${entryPath} ${entryStat.mtimeMs} ${fileHash}`);
        }
    }
    return lines;
}

// Two plain files: a.txt is the replayed file and b.txt gets a Write and an Edit.
function writeTwoFileProject(t: TestContext): ProjectWithFiles {
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "two\n"], ["b.txt", "b1\n"]]);
    return writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const replayedPath = filePathByFileName.get(REPLAYED_FILE_NAME)!;
        const otherPath = filePathByFileName.get("b.txt")!;
        return [
            ...makeEditRows(projectFolder, "toolu_a1", replayedPath, "one", "two", "one\n", 15),
            ...makeWriteCreateRows(projectFolder, "toolu_b1", otherPath, "b0\n", 10),
            ...makeEditRows(projectFolder, "toolu_b2", otherPath, "b0", "b1", "b0\n", 20),
        ];
    });
}

test("test_every_other_file_gets_a_repo_and_a_commit_list_and_the_replayed_file_gets_none", (t) => {
    // Scenario: a.txt is replayed; b.txt has a Write at second 10 and an Edit at second 20.
    const project = writeTwoFileProject(t);
    // The walker runs over the project.
    const walkedFiles = walkProject(project);
    // There is one result, for b.txt.
    assert.equal(walkedFiles.length, 1);
    assert.equal(walkedFiles[0]!.file.toString(), project.fileByName.get("b.txt")!.toString());
    // b.txt has a repo in the store and a.txt has none.
    assert.equal(existsSync(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileByName.get("b.txt")!).toString()), true);
    assert.equal(existsSync(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileByName.get(REPLAYED_FILE_NAME)!).toString()), false);
    // At second 15 the commit list answers with the text of the Write.
    assert.equal(selectInverseCommitAtInstant(walkedFiles[0]!.commits, makeInstant(15))!.text, "b0\n");
});

test("test_the_walk_reports_one_progress_event_for_each_other_file", (t) => {
    // Scenario: a.txt is replayed; b.txt and c.txt are the other files.
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "a\n"], ["b.txt", "b1\n"], ["c.txt", "c1\n"]]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_b1", filePathByFileName.get("b.txt")!, "b0", "b1", "b0\n", 20),
        ...makeEditRows(projectFolder, "toolu_c1", filePathByFileName.get("c.txt")!, "c0", "c1", "c0\n", 30),
    ]);
    // The walker runs with a sink that collects the events.
    const progressEvents: ProgressEvent[] = [];
    walkProject(project, (event) => progressEvents.push(event));
    // There are two events, counted 1 and 2 of 2, and each label starts with the row name.
    assert.equal(progressEvents.length, 2);
    assert.deepEqual(progressEvents.map((event) => event.current), [1, 2]);
    for (const event of progressEvents) {
        assert.equal(event.kind, DocumentResponseKind.progress);
        assert.equal(event.total, 2);
        assert.equal(event.label.startsWith("other files"), true);
    }
});

test("test_a_file_born_by_cp_takes_the_text_of_its_source_just_before_the_copy", (t) => {
    // Scenario: src.txt is "s1" then "s2"; at second 30 `cp src.txt copy.txt` runs; copy.txt differs on disk.
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "a\n"], ["src.txt", "s2\n"], ["copy.txt", "disk-differs\n"]]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const sourcePath = filePathByFileName.get("src.txt")!;
        const copyPath = filePathByFileName.get("copy.txt")!;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_s1", sourcePath, "s1\n", 10),
            ...makeEditRows(projectFolder, "toolu_s2", sourcePath, "s1", "s2", "s1\n", 20),
            ...makeBashRows(projectFolder, "toolu_c1", `cp ${sourcePath} ${copyPath}`, 30),
        ];
    });
    // The walker runs over the project.
    const walkedFiles = walkProject(project);
    // Just after the copy the commit list of copy.txt holds the text of src.txt just before the copy.
    const copyWalked = walkedFiles.find((walkedFile) => walkedFile.file.equals(project.fileByName.get("copy.txt")!))!;
    assert.equal(selectInverseCommitAtInstant(copyWalked.commits, makeInstant(35))!.text, "s2\n");
});

test("test_two_files_born_from_each_other_throw", (t) => {
    // Scenario: one command copies x.txt onto y.txt and y.txt onto x.txt.
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "a\n"], ["x.txt", "x\n"], ["y.txt", "y\n"]]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const xPath = filePathByFileName.get("x.txt")!;
        const yPath = filePathByFileName.get("y.txt")!;
        return makeBashRows(projectFolder, "toolu_x1", `cp ${yPath} ${xPath} && cp ${xPath} ${yPath}`, 10);
    });
    // The walker throws a cycle error.
    assert.throws(() => walkProject(project), /are each born from the other/);
});

test("test_a_file_born_from_the_replayed_file_throws", (t) => {
    // Scenario: `cp a.txt copy.txt` runs and a.txt is the replayed file.
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "a\n"], ["copy.txt", "a\n"]]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        return makeBashRows(projectFolder, "toolu_c1", `cp ${filePathByFileName.get(REPLAYED_FILE_NAME)!} ${filePathByFileName.get("copy.txt")!}`, 10);
    });
    // The walker throws and the message names copy.txt.
    assert.throws(() => walkProject(project), /copy\.txt is born from the replayed file/);
});

// The Write state of b.txt is stored with other text, in a repo that keeps the stamp of the real inputs.
function tamperStoredWriteCommitOfOtherFile(project: ProjectWithFiles): void {
    const replayFiles = makeProjectFiles(project);
    const otherProjectFile = findProjectFileByName(replayFiles, "b.txt");
    const fileName = "b.txt";
    mkdirSync(project.storeFolder.toString(), { recursive: true });
    buildOnDemandInverseReposForFiles(project.projectFolder, [otherProjectFile], [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, otherProjectFile.file);
    const stampText = readFileSync(join(repoFolder.toString(), STAMP_FILE_NAME), "utf8");
    const events = createProjectEventsLoader(replayFiles, [project.jsonlsFolder], [project.snapshotFolder])(replayFiles.indexOf(otherProjectFile));
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    let outcome: InverseStepOutcome | undefined;
    while (outcome !== InverseStepOutcome.NoOlderChange) {
        outcome = stepFileAndWriteCommit(repoFolder, fileName, step, undefined).result.outcome;
    }
    const walkedStates = step.walk.knownStates;
    const writePosition = walkedStates.findIndex((state) => state.event.type === FileEventType.WriteRow && state.confidence === StateConfidence.Proven && !state.isFileAbsent);
    assert.notEqual(writePosition, -1);
    rmSync(repoFolder.toString(), { recursive: true, force: true });
    createInverseRepo(repoFolder, fileName, { state: walkedStates[0]!, position: 0 }, DISK_NOW_INSTANT);
    const tamperedState = { ...walkedStates[writePosition]!, text: "tampered\n" };
    insertStatesIntoInverseRepo(repoFolder, fileName, [{ state: tamperedState, position: writePosition }]);
    writeFileSync(join(repoFolder.toString(), STAMP_FILE_NAME), stampText);
}

test("test_a_repo_that_does_not_match_the_replayed_states_throws", (t) => {
    // Scenario: the stored repo of b.txt holds other text for its proven Write state.
    const project = writeTwoFileProject(t);
    tamperStoredWriteCommitOfOtherFile(project);
    // The walker throws "start again from now" and the error is not caught.
    assert.throws(() => walkProject(project), /does not match the replayed state: start again from now/);
});

test("test_the_walk_creates_no_repo_folder_for_the_replayed_file_and_changes_no_file_of_it", (t) => {
    // Scenario: the replayed file a.txt has a repo with two commits.
    const project = writeTwoFileProject(t);
    const replayFiles = makeProjectFiles(project);
    const replayedProjectFile = findProjectFileByName(replayFiles, REPLAYED_FILE_NAME);
    mkdirSync(project.storeFolder.toString(), { recursive: true });
    buildOnDemandInverseReposForFiles(project.projectFolder, [replayedProjectFile], [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const replayedRepoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, replayedProjectFile.file);
    const replayedEvents = createProjectEventsLoader(replayFiles, [project.jsonlsFolder], [project.snapshotFolder])(replayFiles.indexOf(replayedProjectFile));
    const replayedStep = createFileStep(replayedEvents, listInverseCommits(replayedRepoFolder, REPLAYED_FILE_NAME, true));
    stepFileAndWriteCommit(replayedRepoFolder, REPLAYED_FILE_NAME, replayedStep, undefined);
    const commitsBefore = listInverseCommits(replayedRepoFolder, REPLAYED_FILE_NAME, true);
    assert.equal(commitsBefore.length, 2);
    const treeBefore = describeFolderTree(replayedRepoFolder.toString());
    // The walker runs over the project.
    walkProject(project);
    // The commit list and the folder tree of a.txt are equal, and b.txt has its repo.
    assert.deepEqual(listInverseCommits(replayedRepoFolder, REPLAYED_FILE_NAME, true), commitsBefore);
    assert.deepEqual(describeFolderTree(replayedRepoFolder.toString()), treeBefore);
    assert.equal(existsSync(getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileByName.get("b.txt")!).toString()), true);
});

test("test_walkOtherFilesToTheEnd_applies_the_boundary_to_the_other_files", (t) => {
    // Scenario: b.txt is edited from "b0" to "b1" at second 10 and from "b1" to "b2" at second 20; the commit C at second 15 holds b.txt with "b1".
    const diskTextByFileName = new Map<string, string>([[REPLAYED_FILE_NAME, "a\n"], ["b.txt", "b2\n"]]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_b1", filePathByFileName.get("b.txt")!, "b0", "b1", null, 10),
        ...makeEditRows(projectFolder, "toolu_b2", filePathByFileName.get("b.txt")!, "b1", "b2", null, 20),
    ]);
    const commitHash = commitFileAtSecond(project.projectFolder.toString(), "b.txt", "b1\n", 15);
    writeFileSync(project.fileByName.get("b.txt")!.toString(), "b2\n");
    const boundary = readEarliestBoundary(project.projectFolder, new Uuid(commitHash));
    // The walker runs with the boundary.
    const walkedFiles = walkProject(project, () => {}, boundary);
    // The oldest commit of b.txt holds the text of C, and the older text "b0" is stored nowhere.
    const otherCommits = walkedFiles[0]!.commits;
    assert.equal(otherCommits[otherCommits.length - 1]!.text, "b1\n");
    assert.equal(otherCommits.some((walkedCommit) => walkedCommit.text === "b0\n"), false);
});

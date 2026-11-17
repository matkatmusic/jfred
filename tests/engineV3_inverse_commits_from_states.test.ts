// The commit list derived from a finished step walk answers like a full build at every instant.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, rmSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { createFileStep, type FileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { StateConfidence } from "../engineV3/engineV3_file_known_states.ts";
import { listInverseCommits, type InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { selectInverseCommitAtInstant } from "../engineV3/engineV3_inverse_repo_read.ts";
import { listInverseCommitsFromWalkedStates } from "../engineV3/engineV3_inverse_commits_from_states.ts";
import { buildInverseReposForFiles, buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { makeBashRows, makeEditRows, makeInstant, makeWriteCreateRows, writeProjectFiles } from "./engineV3_step_test_projects.ts";
import { SESSION_A } from "./multi-source-test-helpers.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const DISK_MODIFIED_SECOND = 100;
const LAST_PROBE_SECOND = 110;
const EVENT_SECONDS = [10, 20, 30, 40, 50, 100];
const HOLE_FILE_NAME = "hole.txt";
const READ_EQUAL_DISK_FILE_NAME = "read-equal-disk.txt";
const GONE_FILE_NAME = "gone.txt";
const BEHIND_SCRIPT_FILE_NAME = "behind-script.txt";

type FileCommitLists = { fullCommits: InverseCommit[]; stepCommits: InverseCommit[]; derivedCommits: InverseCommit[]; walkedStates: FileStep["walk"]["knownStates"] };
type ChosenState = { isFileAbsent: boolean; text: string | undefined } | undefined;

function makeReadWholeRows(projectFolder: string, toolUseId: string, filePath: string, content: string, second: number): object[] {
    const toolUseResult = { type: "text", file: { filePath, content, numLines: 1, startLine: 1, totalLines: 1 } };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Read", input: { file_path: filePath }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

function stepFileToTheEnd(repoFolder: Path, fileName: string, step: FileStep): void {
    let outcome: InverseStepOutcome | undefined;
    while (outcome !== InverseStepOutcome.NoOlderChange) {
        outcome = stepFileAndWriteCommit(repoFolder, fileName, step, undefined).result.outcome;
    }
}

// Four files, one full-build store and one step store, for the commit lists of each file.
function buildFileCommitLists(t: TestContext): Map<string, FileCommitLists> {
    const diskTextByFileName = new Map<string, string>([
        [HOLE_FILE_NAME, "four\n"],
        [READ_EQUAL_DISK_FILE_NAME, "same\n"],
        [GONE_FILE_NAME, "g1\n"],
        [BEHIND_SCRIPT_FILE_NAME, "v1\n"],
    ]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const holePath = filePathByFileName.get(HOLE_FILE_NAME)!;
        const readPath = filePathByFileName.get(READ_EQUAL_DISK_FILE_NAME)!;
        const gonePath = filePathByFileName.get(GONE_FILE_NAME)!;
        const scriptPath = filePathByFileName.get(BEHIND_SCRIPT_FILE_NAME)!;
        return [
            ...makeEditRows(projectFolder, "toolu_h1", holePath, "one", "two", "one\n", 20),
            ...makeEditRows(projectFolder, "toolu_h2", holePath, "two", "three", "two\n", 30),
            ...makeEditRows(projectFolder, "toolu_h3", holePath, "three", "four", "three\n", 40),
            ...makeReadWholeRows(projectFolder, "toolu_r1", readPath, "same\n", 50),
            ...makeWriteCreateRows(projectFolder, "toolu_g1", gonePath, "g0\n", 10),
            ...makeEditRows(projectFolder, "toolu_g2", gonePath, "g0", "g1", "g0\n", 20),
            ...makeWriteCreateRows(projectFolder, "toolu_s1", scriptPath, "v0\n", 10),
            ...makeBashRows(projectFolder, "toolu_s2", `printf 'v1\\n' > ${scriptPath}`, 20),
        ];
    });
    for (const [fileName, file] of project.fileByName) {
        if (fileName !== GONE_FILE_NAME) {
            utimesSync(file.toString(), makeInstant(DISK_MODIFIED_SECOND), makeInstant(DISK_MODIFIED_SECOND));
        }
    }
    rmSync(project.fileByName.get(GONE_FILE_NAME)!.toString());
    const projectFiles: ProjectFile[] = [...project.fileByName.values()].map((file) => ({ file, transcriptFile: file }));
    const jsonlsFolders = [project.jsonlsFolder];
    const snapshotFolders = [project.snapshotFolder];
    const fullStoreFolder = new Path(join(project.rootFolder, "full-store"));
    mkdirSync(fullStoreFolder.toString());
    mkdirSync(project.storeFolder.toString());
    buildInverseReposForFiles(project.projectFolder, projectFiles, jsonlsFolders, snapshotFolders, fullStoreFolder, DISK_NOW_INSTANT, () => {});
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, jsonlsFolders, project.storeFolder, DISK_NOW_INSTANT, () => {});
    const getEvents = createProjectEventsLoader(projectFiles, jsonlsFolders, snapshotFolders);
    const commitListsByFileName = new Map<string, FileCommitLists>();
    for (const [index, projectFile] of projectFiles.entries()) {
        const fileName = basename(projectFile.file.toString());
        const fullRepoFolder = getInverseRepoFolderForFile(fullStoreFolder, project.projectFolder, projectFile.file);
        const stepRepoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, projectFile.file);
        const step = createFileStep(getEvents(index), listInverseCommits(stepRepoFolder, fileName, true));
        stepFileToTheEnd(stepRepoFolder, fileName, step);
        const stepCommits = listInverseCommits(stepRepoFolder, fileName, true);
        const fullCommits = listInverseCommits(fullRepoFolder, fileName, true);
        const derivedCommits = listInverseCommitsFromWalkedStates(step.walk.knownStates, stepCommits);
        commitListsByFileName.set(fileName, { fullCommits, stepCommits, derivedCommits, walkedStates: step.walk.knownStates });
    }
    return commitListsByFileName;
}

function listProbeInstants(): Date[] {
    const probeInstants: Date[] = [];
    for (let second = 0; second <= LAST_PROBE_SECOND; second += 1) {
        probeInstants.push(makeInstant(second));
    }
    for (const eventSecond of EVENT_SECONDS) {
        probeInstants.push(new Date(makeInstant(eventSecond).getTime() - 1));
        probeInstants.push(new Date(makeInstant(eventSecond).getTime() + 1));
    }
    return probeInstants;
}

function describeChosenState(commits: InverseCommit[], instant: Date): ChosenState {
    const chosenCommit = selectInverseCommitAtInstant(commits, instant);
    if (chosenCommit === undefined) {
        return undefined;
    }
    return { isFileAbsent: chosenCommit.isFileAbsent, text: chosenCommit.text };
}

function assertDerivedAnswersLikeFullBuild(commitLists: FileCommitLists): void {
    for (const probeInstant of listProbeInstants()) {
        const fullAnswer = describeChosenState(commitLists.fullCommits, probeInstant);
        const derivedAnswer = describeChosenState(commitLists.derivedCommits, probeInstant);
        assert.deepEqual(derivedAnswer, fullAnswer, `instant ${probeInstant.toISOString()}`);
    }
}

test("test_plain_step_commits_have_a_hole_between_the_newest_event_and_the_disk_time", (t) => {
    // Scenario: hole.txt has edits at seconds 20, 30, 40 and a disk time at second 100.
    const commitLists = buildFileCommitLists(t).get(HOLE_FILE_NAME)!;
    // The full build answers "four" at second 45.
    const fullAnswer = describeChosenState(commitLists.fullCommits, makeInstant(45));
    assert.deepEqual(fullAnswer, { isFileAbsent: false, text: "four\n" });
    // The plain step commits answer nothing at second 45: that is the hole.
    assert.equal(selectInverseCommitAtInstant(commitLists.stepCommits, makeInstant(45)), undefined);
});

test("test_derived_commits_answer_like_a_full_build_for_every_second_of_hole_txt", (t) => {
    const commitLists = buildFileCommitLists(t).get(HOLE_FILE_NAME)!;
    assertDerivedAnswersLikeFullBuild(commitLists);
    assert.deepEqual(describeChosenState(commitLists.derivedCommits, makeInstant(45)), { isFileAbsent: false, text: "four\n" });
    assert.deepEqual(describeChosenState(commitLists.derivedCommits, makeInstant(35)), { isFileAbsent: false, text: "three\n" });
});

test("test_derived_commits_answer_like_a_full_build_for_every_second_of_read_equal_disk_txt", (t) => {
    const commitLists = buildFileCommitLists(t).get(READ_EQUAL_DISK_FILE_NAME)!;
    assertDerivedAnswersLikeFullBuild(commitLists);
    assert.deepEqual(describeChosenState(commitLists.derivedCommits, makeInstant(60)), { isFileAbsent: false, text: "same\n" });
});

test("test_derived_commits_answer_like_a_full_build_for_every_second_of_gone_txt", (t) => {
    const commitLists = buildFileCommitLists(t).get(GONE_FILE_NAME)!;
    assertDerivedAnswersLikeFullBuild(commitLists);
    assert.deepEqual(describeChosenState(commitLists.derivedCommits, makeInstant(105)), { isFileAbsent: false, text: "g1\n" });
});

test("test_derived_commits_answer_like_a_full_build_for_every_second_of_behind_script_txt", (t) => {
    const commitLists = buildFileCommitLists(t).get(BEHIND_SCRIPT_FILE_NAME)!;
    assert.ok(commitLists.walkedStates.some((state) => state.confidence === StateConfidence.Unknown), "the fixture must hold an Unknown stretch");
    assertDerivedAnswersLikeFullBuild(commitLists);
    assert.deepEqual(describeChosenState(commitLists.derivedCommits, makeInstant(15)), { isFileAbsent: false, text: "v0\n" });
});

test("test_a_state_text_that_differs_from_its_step_commit_throws", (t) => {
    const commitLists = buildFileCommitLists(t).get(HOLE_FILE_NAME)!;
    // Position 1 is the at-event state of the newest edit: its text equals the disk text, so the step wrote no commit for it.
    const changedStates = commitLists.walkedStates.map((state, position) => {
        if (position === 1) {
            return { ...state, text: "changed by hand\n" };
        }
        return state;
    });
    assert.throws(() => listInverseCommitsFromWalkedStates(changedStates, commitLists.stepCommits));
});

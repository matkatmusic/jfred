// The earliest boundary: a commit C of a repo R is the earliest known state of every file.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { applyEarliestBoundaryToEvents, readEarliestBoundary, readFileTextAtBoundary, type EarliestBoundary } from "../engineV3/engineV3_earliest_boundary.ts";
import { FileEventType, createEvent, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { createFileStep, stepFileToNextTextChange } from "../engineV3/engineV3_file_step.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, listStatesOfProjectFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import type { FileKnownState } from "../engineV3/engineV3_file_known_states.ts";
import { initGitRepo, makeBashRows, makeEditRows, makeInstant, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const COMMIT_SECOND = 15;
const COMMIT_TEXT = "one\n";

function runGit(folder: string, gitArguments: string[], commitSecond?: number): string {
    const environment = { ...process.env };
    if (commitSecond !== undefined) {
        environment.GIT_COMMITTER_DATE = `@${makeInstant(commitSecond).getTime() / 1000} +0000`;
        environment.GIT_AUTHOR_DATE = environment.GIT_COMMITTER_DATE;
    }
    return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...gitArguments], { cwd: folder, env: environment, encoding: "utf8" }).trim();
}

// Writes the file, commits it with the given committer date, and returns the full hash of the commit.
function commitFileAtDate(folder: string, relativePath: string, text: string, commitSecond: number): string {
    const filePath = join(folder, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, text);
    runGit(folder, ["add", "--", relativePath]);
    runGit(folder, ["commit", "-q", "-m", `commit of ${relativePath}`], commitSecond);
    return runGit(folder, ["rev-parse", "HEAD"]);
}

function makeFolderInsideTemporaryFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(realpathSync(tmpdir()), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// A git repo whose commit C, at second 15, holds a.txt with the text "one".
function makeRepoWithCommit(t: TestContext): { repoFolder: Path; commit: Uuid } {
    const folder = makeFolderInsideTemporaryFolder(t, "engine-v3-boundary-");
    initGitRepo(folder);
    const commitHash = commitFileAtDate(folder, "a.txt", COMMIT_TEXT, COMMIT_SECOND);
    return { repoFolder: new Path(folder), commit: new Uuid(commitHash) };
}

function makeEditEvent(second: number): FileEvent {
    return createEvent(FileEventType.EditRow, makeInstant(second), undefined, { bytes: `text at ${second}` });
}

function listInstantSeconds(events: FileEvent[]): (number | null)[] {
    return events.map((event) => (event.instant === undefined ? null : (event.instant.getTime() - makeInstant(0).getTime()) / 1000));
}

// Newest first: the disk now event, then the edits at seconds 30, 15 (the time of C) and 5.
function makeEventsAroundTheCommit(): FileEvent[] {
    return [createEvent(FileEventType.DiskNow, undefined, undefined, { bytes: "disk\n" }), makeEditEvent(30), makeEditEvent(COMMIT_SECOND), makeEditEvent(5)];
}

test("test_readEarliestBoundary_returns_the_committer_time_of_the_commit", (t) => {
    // Scenario: the commit C was made at second 15.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    // The boundary holds the committer time of C.
    const boundary = readEarliestBoundary(repoFolder, commit);
    assert.equal(boundary.instant.getTime(), makeInstant(COMMIT_SECOND).getTime());
    assert.equal(boundary.repoFolder.toString(), repoFolder.toString());
});

test("test_readEarliestBoundary_throws_on_an_unknown_commit", (t) => {
    // Scenario: the repo has no commit with this hash.
    const { repoFolder } = makeRepoWithCommit(t);
    // Reading the boundary throws.
    assert.throws(() => readEarliestBoundary(repoFolder, new Uuid("0123456789012345678901234567890123456789")));
});

test("test_readEarliestBoundary_stores_the_full_hash_for_an_abbreviated_commit", (t) => {
    // Scenario: the commit is named by its first 7 characters.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    // The boundary holds the full hash of the same commit.
    const boundary = readEarliestBoundary(repoFolder, new Uuid(commit.toString().slice(0, 7)));
    assert.equal(boundary.commit.toString(), commit.toString());
});

test("test_readFileTextAtBoundary_returns_the_text_the_file_had_in_the_commit", (t) => {
    // Scenario: a.txt has the text "one" in C and the text "two" in a later commit.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    commitFileAtDate(repoFolder.toString(), "a.txt", "two\n", 40);
    const boundary = readEarliestBoundary(repoFolder, commit);
    // The text at the boundary is "one".
    const fileAtBoundary = readFileTextAtBoundary(boundary, new Path(join(repoFolder.toString(), "a.txt")));
    assert.deepEqual(fileAtBoundary, { isInsideRepo: true, text: COMMIT_TEXT });
});

test("test_readFileTextAtBoundary_returns_no_text_for_a_commit_without_the_file", (t) => {
    // Scenario: b.txt is added after C.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    commitFileAtDate(repoFolder.toString(), "b.txt", "bee\n", 40);
    const boundary = readEarliestBoundary(repoFolder, commit);
    // The file is inside the repo and has no text at the boundary.
    const fileAtBoundary = readFileTextAtBoundary(boundary, new Path(join(repoFolder.toString(), "b.txt")));
    assert.deepEqual(fileAtBoundary, { isInsideRepo: true, text: undefined });
});

test("test_readFileTextAtBoundary_marks_a_file_outside_the_repo", (t) => {
    // Scenario: a file lies in a folder next to the repo.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    const boundary = readEarliestBoundary(repoFolder, commit);
    const outsideFile = new Path(join(dirname(repoFolder.toString()), "outside-engine-v3-boundary.txt"));
    // The file is marked as outside the repo.
    assert.deepEqual(readFileTextAtBoundary(boundary, outsideFile), { isInsideRepo: false, text: undefined });
});

test("test_readFileTextAtBoundary_marks_a_file_inside_a_submodule_as_outside_the_repo", (t) => {
    // Scenario: the folder sub is a submodule of the repo (a gitlink entry in C), and holds x.txt.
    const folder = makeFolderInsideTemporaryFolder(t, "engine-v3-boundary-");
    initGitRepo(folder);
    const submoduleFolder = join(folder, "sub");
    mkdirSync(submoduleFolder);
    initGitRepo(submoduleFolder);
    commitFileAtDate(submoduleFolder, "x.txt", "ex\n", 10);
    runGit(folder, ["add", "--", "sub"]);
    runGit(folder, ["commit", "-q", "-m", "add the submodule"], COMMIT_SECOND);
    const boundary = readEarliestBoundary(new Path(folder), new Uuid(runGit(folder, ["rev-parse", "HEAD"])));
    // The file in the submodule is marked as outside the repo.
    assert.deepEqual(readFileTextAtBoundary(boundary, new Path(join(submoduleFolder, "x.txt"))), { isInsideRepo: false, text: undefined });
});

test("test_events_at_or_before_the_commit_time_are_dropped", (t) => {
    // Scenario: events at seconds 30, 15 (the time of C) and 5, and a file that is in C.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    const boundary = readEarliestBoundary(repoFolder, commit);
    // Applying the boundary keeps the event at second 30 and drops the events at seconds 15 and 5.
    const events = applyEarliestBoundaryToEvents(makeEventsAroundTheCommit(), boundary, { isInsideRepo: true, text: undefined });
    assert.deepEqual(listInstantSeconds(events), [null, 30]);
});

test("test_the_commit_text_becomes_the_oldest_event", (t) => {
    // Scenario: a file that is in C with the text "one".
    const { repoFolder, commit } = makeRepoWithCommit(t);
    const boundary = readEarliestBoundary(repoFolder, commit);
    // The last event is a GitCommit event with the commit text, the commit hash and the time of C.
    const events = applyEarliestBoundaryToEvents(makeEventsAroundTheCommit(), boundary, { isInsideRepo: true, text: COMMIT_TEXT });
    const oldestEvent = events[events.length - 1]!;
    assert.equal(oldestEvent.type, FileEventType.GitCommit);
    assert.equal(oldestEvent.bytes, COMMIT_TEXT);
    assert.equal(oldestEvent.instant!.getTime(), makeInstant(COMMIT_SECOND).getTime());
    assert.equal(oldestEvent.commitHash!.toString(), commit.toString());
    assert.deepEqual(listInstantSeconds(events), [null, 30, COMMIT_SECOND]);
});

test("test_disk_now_event_survives_the_boundary", (t) => {
    // Scenario: the newest event is the disk now event, which has no instant.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    const boundary = readEarliestBoundary(repoFolder, commit);
    // After the boundary the disk now event is still the first event.
    const events = applyEarliestBoundaryToEvents(makeEventsAroundTheCommit(), boundary, { isInsideRepo: true, text: COMMIT_TEXT });
    assert.equal(events[0]!.type, FileEventType.DiskNow);
});

test("test_a_file_outside_the_repo_keeps_all_its_events", (t) => {
    // Scenario: a file outside the repo has events older than C.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    const boundary = readEarliestBoundary(repoFolder, commit);
    const eventsBefore = makeEventsAroundTheCommit();
    // The boundary returns the same events.
    const eventsAfter = applyEarliestBoundaryToEvents(eventsBefore, boundary, { isInsideRepo: false, text: undefined });
    assert.deepEqual(eventsAfter, eventsBefore);
});

test("test_a_file_missing_from_the_commit_gets_no_beacon_but_loses_older_events", (t) => {
    // Scenario: a file is inside the repo, but C does not hold it.
    const { repoFolder, commit } = makeRepoWithCommit(t);
    const boundary = readEarliestBoundary(repoFolder, commit);
    // The events at or before C are dropped and no GitCommit event is added.
    const events = applyEarliestBoundaryToEvents(makeEventsAroundTheCommit(), boundary, { isInsideRepo: true, text: undefined });
    assert.deepEqual(listInstantSeconds(events), [null, 30]);
    assert.equal(events.some((event) => event.type === FileEventType.GitCommit), false);
});

type WalkedState = { text: string | undefined; instant: Date | undefined };

// Steps the file to its end (or to its first stop) without writing, and returns the written states and the last outcome.
function walkProjectFileToItsEnd(project: ProjectWithFiles, fileName: string, boundary: EarliestBoundary): { writtenStates: WalkedState[]; lastOutcome: InverseStepOutcome } {
    const projectFiles: ProjectFile[] = [...project.fileByName.values()].map((file) => ({ file, transcriptFile: file }));
    const stepProjectFile = projectFiles.find((projectFile) => basename(projectFile.file.toString()) === fileName)!;
    const getEvents = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder], boundary);
    const stepFileIndex = projectFiles.indexOf(stepProjectFile);
    const statesByFile: (FileKnownState[] | undefined)[] = projectFiles.map(() => undefined);
    listStatesOfProjectFile(stepFileIndex, projectFiles, getEvents, statesByFile, new Set<number>());
    buildOnDemandInverseReposForFiles(project.projectFolder, [stepProjectFile], [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, stepProjectFile.file);
    const step = createFileStep(getEvents(stepFileIndex), listInverseCommits(repoFolder, fileName, true));
    const writtenStates: WalkedState[] = [];
    let lastOutcome: InverseStepOutcome;
    do {
        const result = stepFileToNextTextChange(step, undefined);
        lastOutcome = result.outcome;
        if (result.writtenState !== undefined) {
            writtenStates.push({ text: result.writtenState.state.text, instant: result.writtenState.state.event.instant });
        }
    } while (lastOutcome !== InverseStepOutcome.NoOlderChange && lastOutcome !== InverseStepOutcome.UnknownOrRoadblock);
    return { writtenStates, lastOutcome };
}

test("test_a_file_in_the_commit_that_is_later_replaced_by_a_move_does_not_get_the_commit_text_at_the_move", (t) => {
    // Scenario: x.txt is in C with the text "x0"; y.txt gets "y1" at second 10; at second 20 a copy puts y.txt onto x.txt.
    const project = writeProjectFiles(t, new Map([["x.txt", "y1\n"], ["y.txt", "y1\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_y1", filePathByFileName.get("y.txt")!, "y0", "y1", null, 10),
        ...makeBashRows(projectFolder, "toolu_cp", `cp ${filePathByFileName.get("y.txt")!} ${filePathByFileName.get("x.txt")!}`, 20),
    ]);
    const commitHash = commitFileAtDate(project.projectFolder.toString(), "x.txt", "x0\n", COMMIT_SECOND);
    writeFileSync(project.fileByName.get("x.txt")!.toString(), "y1\n");
    const boundary = readEarliestBoundary(project.projectFolder, new Uuid(commitHash));
    // The walk of x.txt runs to its end or to a stop.
    const { writtenStates } = walkProjectFileToItsEnd(project, "x.txt", boundary);
    // No written state at or after the copy (second 20) has the commit text.
    const statesAtOrAfterTheCopy = writtenStates.filter((writtenState) => writtenState.instant === undefined || writtenState.instant.getTime() >= makeInstant(20).getTime());
    assert.equal(statesAtOrAfterTheCopy.some((writtenState) => writtenState.text === "x0\n"), false);
});

test("test_loader_with_a_boundary_ends_the_walk_at_the_commit_text", (t) => {
    // Scenario: a.txt is committed with "zero" at second 5 and with "one" at second 15 (C); the logs edit one to two at 20 and two to three at 30.
    const project = writeProjectFiles(t, new Map([["a.txt", "three\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 20),
        ...makeEditRows(projectFolder, "toolu_b", filePathByFileName.get("a.txt")!, "two", "three", null, 30),
    ]);
    commitFileAtDate(project.projectFolder.toString(), "a.txt", "zero\n", 5);
    const commitHash = commitFileAtDate(project.projectFolder.toString(), "a.txt", COMMIT_TEXT, COMMIT_SECOND);
    writeFileSync(project.fileByName.get("a.txt")!.toString(), "three\n");
    const boundary = readEarliestBoundary(project.projectFolder, new Uuid(commitHash));
    // The walk runs to its end.
    const { writtenStates, lastOutcome } = walkProjectFileToItsEnd(project, "a.txt", boundary);
    assert.equal(lastOutcome, InverseStepOutcome.NoOlderChange);
    // The oldest written state has the commit text, and no state holds the older "zero" text.
    assert.equal(writtenStates[writtenStates.length - 1]!.text, COMMIT_TEXT);
    assert.equal(writtenStates.some((writtenState) => writtenState.text === "zero\n"), false);
});

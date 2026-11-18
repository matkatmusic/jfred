// The --startAt walk of the step program: one process walks a file until its stored commits cover an instant.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import type { Path } from "../src/structures/domain.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { listInverseCommits, type InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { runStepCommands, type StepCliSession } from "../engineV3/engineV3_step_cli.ts";
import { stepUntilInstantIsSpanned } from "../engineV3/engineV3_step_start_at.ts";
import { readWalkCoverage } from "../engineV3/engineV3_walk_coverage.ts";
import { PROJECT_FILE_NAME, commitFileAtSecond, makeBashRows, makeEditRows, makeInstant, makeWriteCreateRows, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const JFRED_FOLDER = join(import.meta.dirname, "..");
const PROGRAM_FILE = "engineV3/engineV3_inverse_repos_for_project.ts";
const PROGRAM_TIMEOUT_MILLISECONDS = 110000;
const USAGE_PATTERN = /usage:/;

type PrintedLine = Record<string, unknown>;

// Disk text "four"; Edit one to two at second 20, two to three at second 30, three to four at second 40.
// The stored commits, newest first: disk now, three at 40, two at 30, one at 20.
function writeThreeEditProject(t: TestContext): Project {
    return writeProject(t, "four\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 20),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 30),
        ...makeEditRows(projectFolder, "toolu_c", filePath, "three", "four", null, 40),
    ]);
}

// Disk text "v1": a Write of "v0" at second 10, then a script at second 20 that writes "v1": the walk stops at the script.
function writeScriptStopProject(t: TestContext): Project {
    return writeProject(t, "v1\n", (projectFolder, filePath) => [
        ...makeWriteCreateRows(projectFolder, "toolu_w1", filePath, "v0\n", 10),
        ...makeBashRows(projectFolder, "toolu_s1", `printf 'v1\\n' > ${filePath}`, 20),
    ]);
}

function makeSession(project: Project, storeFolder: Path = project.storeFolder): StepCliSession {
    const projectFiles = [{ file: project.file, transcriptFile: project.file }];
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    const fileName = basename(project.file.toString());
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    return { repoFolder, fileName, relativeFile: PROJECT_FILE_NAME, events, step };
}

function captureLines(t: TestContext): PrintedLine[] {
    const printedLines: PrintedLine[] = [];
    t.mock.method(console, "log", (printedText: string) => {
        printedLines.push(JSON.parse(printedText) as PrintedLine);
    });
    return printedLines;
}

function countStoredCommits(session: StepCliSession): number {
    return listInverseCommits(session.repoFolder, session.fileName, false).length;
}

function findResultLines(printedLines: PrintedLine[]): PrintedLine[] {
    return printedLines.filter((printedLine) => "startAt" in printedLine);
}

async function* makeCommandLines(lines: string[]): AsyncIterable<string> {
    for (const line of lines) {
        yield line;
    }
}

test("test_startAt_in_the_middle_writes_commits_until_the_instant_is_spanned_and_stops", (t) => {
    // Scenario: three stored texts are older than the disk text; the instant is the time of the middle Edit.
    const session = makeSession(writeThreeEditProject(t));
    const printedLines = captureLines(t);
    // The walk runs with startAt at second 30.
    const result = stepUntilInstantIsSpanned(session, makeInstant(30), false);
    // It stops there: the commit of second 30 is the tip, and the commit of second 20 is not written.
    assert.equal(result.outcome, InverseStepOutcome.StartAtReached);
    assert.equal(result.commitsWritten, 2);
    assert.equal(countStoredCommits(session), 3);
    // The last printed line is the result line.
    const lastLine = printedLines[printedLines.length - 1]!;
    assert.equal(lastLine.startAt, makeInstant(30).toISOString());
    assert.equal(lastLine.outcome, InverseStepOutcome.StartAtReached);
    assert.equal(lastLine.commitsWritten, 2);
    const tipCommit = listInverseCommits(session.repoFolder, session.fileName, false).at(-1)!;
    assert.equal(lastLine.position, tipCommit.position);
    assert.equal(lastLine.commit, tipCommit.commitHash.toString());
});

test("test_startAt_between_two_events_walks_to_the_next_older_stored_commit_and_stops", (t) => {
    // Scenario: second 35 is the time of no event; it lies between the Edits of second 30 and second 40.
    const session = makeSession(writeThreeEditProject(t));
    captureLines(t);
    // The walk runs with startAt at second 35.
    const result = stepUntilInstantIsSpanned(session, makeInstant(35), false);
    // The commit of second 30 is the first one at or before the instant, so the walk stops with it as the tip.
    assert.equal(result.outcome, InverseStepOutcome.StartAtReached);
    assert.equal(countStoredCommits(session), 3);
    assert.equal(readWalkCoverage(session.repoFolder)!.tipInstant!.getTime(), makeInstant(30).getTime());
});

test("test_startAt_newer_than_the_tip_writes_nothing_and_says_already_stored", (t) => {
    // Scenario: a fresh repo holds only the disk-now commit.
    const project = writeThreeEditProject(t);
    const session = makeSession(project);
    const printedLines = captureLines(t);
    const commitCountBefore = countStoredCommits(session);
    // The walk runs with startAt one minute after the disk modified time.
    const startAt = new Date(statSync(project.file.toString()).mtime.getTime() + 60000);
    const result = stepUntilInstantIsSpanned(session, startAt, false);
    // It says already-stored, writes no commit, and prints only the result line.
    assert.equal(result.outcome, InverseStepOutcome.AlreadyStored);
    assert.equal(result.commitsWritten, 0);
    assert.equal(countStoredCommits(session), commitCountBefore);
    assert.equal(printedLines.length, 1);
    assert.equal(printedLines[0]!.outcome, InverseStepOutcome.AlreadyStored);
});

test("test_startAt_older_than_every_event_walks_to_no_older_change_and_marks_the_walk_finished", (t) => {
    // Scenario: the instant is older than the oldest Edit.
    const session = makeSession(writeThreeEditProject(t));
    captureLines(t);
    // The walk runs with startAt at second 0.
    const result = stepUntilInstantIsSpanned(session, makeInstant(0), false);
    // It walks to the end: every older text is stored and the coverage says finished.
    assert.equal(result.outcome, InverseStepOutcome.NoOlderChange);
    assert.equal(result.commitsWritten, 3);
    assert.equal(countStoredCommits(session), 4);
    assert.equal(readWalkCoverage(session.repoFolder)!.isFinished, true);
});

test("test_a_second_run_after_a_finished_walk_says_already_stored_for_any_instant", (t) => {
    // Scenario: a walk ran to its end.
    const project = writeThreeEditProject(t);
    captureLines(t);
    stepUntilInstantIsSpanned(makeSession(project), makeInstant(0), false);
    // A new process starts from the stored commits and walks with startAt at second 0 again.
    const secondSession = makeSession(project);
    const commitCountBefore = countStoredCommits(secondSession);
    const result = stepUntilInstantIsSpanned(secondSession, makeInstant(0), false);
    // It says already-stored and writes nothing.
    assert.equal(result.outcome, InverseStepOutcome.AlreadyStored);
    assert.equal(countStoredCommits(secondSession), commitCountBefore);
});

test("test_startAt_stops_at_a_script_stop_and_writes_no_commit_for_it", (t) => {
    // Scenario: the newest event is a script that may write the file.
    const session = makeSession(writeScriptStopProject(t));
    const printedLines = captureLines(t);
    // The walk runs with startAt at second 0 and does not pass stops.
    const result = stepUntilInstantIsSpanned(session, makeInstant(0), false);
    // It stops at the script and writes no commit.
    assert.equal(result.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(result.commitsWritten, 0);
    assert.equal(countStoredCommits(session), 1);
    // The result line names the event type and the log line of the stop.
    const lastLine = printedLines[printedLines.length - 1]!;
    assert.equal(lastLine.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(lastLine.eventType, FileEventType.ScriptMayWrite);
    assert.match(String(lastLine.source), /\.jsonl:\d+$/);
});

test("test_the_printed_step_lines_match_the_f_command_lines", async (t) => {
    // Scenario: one project, two stores.
    const project = writeThreeEditProject(t);
    // In store A the walk prints its lines for startAt at second 30 (two steps).
    const walkLines = captureLines(t);
    stepUntilInstantIsSpanned(makeSession(project), makeInstant(30), false);
    // In store B the f command runs twice.
    t.mock.restoreAll();
    const commandLines = captureLines(t);
    await runStepCommands(makeCommandLines(["f", "f", "q"]), makeSession(project, project.secondStoreFolder));
    // The walk printed the same lines as the f command, with the same keys, plus one result line.
    assert.equal(walkLines.length, commandLines.length + 1);
    for (const [index, commandLine] of commandLines.entries()) {
        assert.deepEqual(Object.keys(walkLines[index]!), Object.keys(commandLine));
        assert.equal(walkLines[index]!.outcome, commandLine.outcome);
        assert.equal(walkLines[index]!.position, commandLine.position);
    }
});

test("test_every_exit_kind_prints_one_last_result_line", (t) => {
    // Scenario: the four exit kinds, each on its own project.
    const exitCases: { session: StepCliSession; startAt: Date; expectedOutcome: InverseStepOutcome }[] = [];
    const alreadyStoredProject = writeThreeEditProject(t);
    exitCases.push({ session: makeSession(alreadyStoredProject), startAt: new Date(statSync(alreadyStoredProject.file.toString()).mtime.getTime() + 60000), expectedOutcome: InverseStepOutcome.AlreadyStored });
    exitCases.push({ session: makeSession(writeThreeEditProject(t)), startAt: makeInstant(30), expectedOutcome: InverseStepOutcome.StartAtReached });
    exitCases.push({ session: makeSession(writeThreeEditProject(t)), startAt: makeInstant(0), expectedOutcome: InverseStepOutcome.NoOlderChange });
    exitCases.push({ session: makeSession(writeScriptStopProject(t)), startAt: makeInstant(0), expectedOutcome: InverseStepOutcome.UnknownOrRoadblock });
    for (const exitCase of exitCases) {
        const printedLines = captureLines(t);
        // The walk returns its outcome.
        const result = stepUntilInstantIsSpanned(exitCase.session, exitCase.startAt, false);
        assert.equal(result.outcome, exitCase.expectedOutcome);
        // Exactly one printed line is a result line, and it is the last one.
        assert.equal(findResultLines(printedLines).length, 1);
        assert.equal(printedLines[printedLines.length - 1]!.outcome, exitCase.expectedOutcome);
        t.mock.restoreAll();
    }
});

test("test_pass_stops_walks_past_a_script_stop_to_no_older_change", (t) => {
    // Scenario: a walk with pass-stops on the script project.
    const session = makeSession(writeScriptStopProject(t));
    captureLines(t);
    const result = stepUntilInstantIsSpanned(session, makeInstant(0), true);
    // It does not end at the script stop: it ends at the end of the history, and the coverage says finished.
    assert.equal(result.outcome, InverseStepOutcome.NoOlderChange);
    assert.equal(readWalkCoverage(session.repoFolder)!.isFinished, true);
});

test("test_without_pass_stops_the_same_walk_ends_at_the_stop", (t) => {
    // Scenario: the same walk without pass-stops.
    const session = makeSession(writeScriptStopProject(t));
    captureLines(t);
    const result = stepUntilInstantIsSpanned(session, makeInstant(0), false);
    // It ends at the stop, and the coverage does not say finished.
    assert.equal(result.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(readWalkCoverage(session.repoFolder)!.isFinished, false);
});

function runProgram(project: Project, extraArguments: string[], inputText: string): { status: number | null; stdout: string; stderr: string } {
    const programArguments = [
        "--import", "tsx", PROGRAM_FILE,
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", project.storeFolder.toString(),
        ...extraArguments,
    ];
    const spawned = spawnSync(process.execPath, programArguments, { input: inputText, cwd: JFRED_FOLDER, encoding: "utf8", timeout: PROGRAM_TIMEOUT_MILLISECONDS });
    return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

function runStepProgram(project: Project, extraArguments: string[], inputText: string): { status: number | null; stdout: string; stderr: string } {
    return runProgram(project, ["--step", PROJECT_FILE_NAME, ...extraArguments], inputText);
}

function listJsonLinesOfProgramOutput(stdout: string): PrintedLine[] {
    return stdout.split("\n").filter((outputLine) => outputLine.startsWith("{")).map((outputLine) => JSON.parse(outputLine) as PrintedLine);
}

function listStoredCommitsOfProject(project: Project): InverseCommit[] {
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    return listInverseCommits(repoFolder, PROJECT_FILE_NAME, true);
}


test("test_cli_startAt_with_standard_input_f_prints_the_start_lines_then_the_two_f_lines", (t) => {
    // Scenario: the program runs with startAt at second 30 and the standard input "f", "q".
    const spawned = runStepProgram(writeThreeEditProject(t), ["--startAt", makeInstant(30).toISOString()], "f\nq\n");
    assert.equal(spawned.status, 0, spawned.stderr);
    // The lines are: the two steps of the walk with their begin lines, the result line, then the begin line and the step line of f.
    const printedLines = listJsonLinesOfProgramOutput(spawned.stdout);
    const lineKinds = printedLines.map((printedLine) => ("startAt" in printedLine ? "startAt" : Object.keys(printedLine)[0]));
    assert.deepEqual(lineKinds, ["begin", "step", "begin", "step", "startAt", "begin", "step"]);
    assert.equal(printedLines[4]!.outcome, InverseStepOutcome.StartAtReached);
});

test("test_cli_repo_without_commit_exits_with_the_usage_text", (t) => {
    // Scenario: --repo is given and --commit is not.
    const project = writeThreeEditProject(t);
    const spawned = runStepProgram(project, ["--repo", project.projectFolder.toString()], "q\n");
    // The program exits with an error that holds the usage text.
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_cli_commit_without_repo_exits_with_the_usage_text", (t) => {
    // Scenario: --commit is given and --repo is not.
    const spawned = runStepProgram(writeThreeEditProject(t), ["--commit", "HEAD"], "q\n");
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_cli_startAt_without_step_exits_with_the_usage_text", (t) => {
    // Scenario: --startAt is given and --step is not.
    const spawned = runProgram(writeThreeEditProject(t), ["--startAt", makeInstant(30).toISOString()], "");
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_cli_startAt_that_is_no_instant_exits_with_the_usage_text", (t) => {
    // Scenario: --startAt holds a word.
    const spawned = runStepProgram(writeThreeEditProject(t), ["--startAt", "yesterday-ish"], "q\n");
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_cli_commit_boundary_makes_the_oldest_stored_text_the_commit_text", (t) => {
    // Scenario: a.txt is committed with "zero" at second 5 and with "one" at second 15 (C); the logs edit one to two at 20 and two to three at 30.
    const project = writeProject(t, "three\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 20),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 30),
    ]);
    commitFileAtSecond(project.projectFolder.toString(), PROJECT_FILE_NAME, "zero\n", 5);
    const commitHash = commitFileAtSecond(project.projectFolder.toString(), PROJECT_FILE_NAME, "one\n", 15);
    writeFileSync(project.file.toString(), "three\n");
    // The program walks to the end with the boundary C.
    const spawned = runStepProgram(project, ["--startAt", makeInstant(0).toISOString(), "--repo", project.projectFolder.toString(), "--commit", commitHash], "q\n");
    assert.equal(spawned.status, 0, spawned.stderr);
    const storedCommits = listStoredCommitsOfProject(project);
    // The oldest stored text is the text of C, and no older "zero" text is stored.
    const oldestCommit = storedCommits[storedCommits.length - 1]!;
    assert.equal(oldestCommit.text, "one\n");
    assert.equal(storedCommits.some((storedCommit) => storedCommit.text === "zero\n"), false);
    // No stored commit is older than C.
    for (const storedCommit of storedCommits) {
        assert.equal(storedCommit.instant!.getTime() >= makeInstant(15).getTime(), true);
    }
});

test("test_cli_startAt_on_a_stored_instant_prints_already_stored_and_exits_zero", (t) => {
    // Scenario: a first run walks to second 30.
    const project = writeThreeEditProject(t);
    const firstRun = runStepProgram(project, ["--startAt", makeInstant(30).toISOString()], "q\n");
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const commitCountBefore = listStoredCommitsOfProject(project).length;
    // A second run asks for second 30 again.
    const secondRun = runStepProgram(project, ["--startAt", makeInstant(30).toISOString()], "q\n");
    assert.equal(secondRun.status, 0, secondRun.stderr);
    // Its result line says already-stored, and the commit count is equal.
    const resultLines = listJsonLinesOfProgramOutput(secondRun.stdout).filter((printedLine) => "startAt" in printedLine);
    assert.equal(resultLines.length, 1);
    assert.equal(resultLines[0]!.outcome, InverseStepOutcome.AlreadyStored);
    assert.equal(listStoredCommitsOfProject(project).length, commitCountBefore);
});

test("test_cli_startAt_with_an_instant_that_is_no_event_time_walks_to_the_covering_commit", (t) => {
    // Scenario: second 35 is the time of no event.
    const project = writeThreeEditProject(t);
    const spawned = runStepProgram(project, ["--startAt", makeInstant(35).toISOString()], "q\n");
    assert.equal(spawned.status, 0, spawned.stderr);
    // The oldest stored commit is the one of second 30.
    const storedCommits = listStoredCommitsOfProject(project);
    assert.equal(storedCommits.length, 3);
    assert.equal(storedCommits[storedCommits.length - 1]!.instant!.getTime(), makeInstant(30).getTime());
});

test("test_cli_pass_stops_walks_past_a_script_stop_to_no_older_change_and_marks_the_walk_finished", (t) => {
    // Scenario: without the flag the walk ends at the script stop.
    const stoppedProject = writeScriptStopProject(t);
    const withoutFlag = runStepProgram(stoppedProject, ["--startAt", makeInstant(0).toISOString()], "q\n");
    assert.equal(withoutFlag.status, 0, withoutFlag.stderr);
    const withoutFlagResult = listJsonLinesOfProgramOutput(withoutFlag.stdout).filter((printedLine) => "startAt" in printedLine)[0]!;
    assert.equal(withoutFlagResult.outcome, InverseStepOutcome.UnknownOrRoadblock);
    // With the flag the walk ends at the end of the history, and the coverage says finished.
    const passedProject = writeScriptStopProject(t);
    const withFlag = runStepProgram(passedProject, ["--startAt", makeInstant(0).toISOString(), "--pass-stops"], "q\n");
    assert.equal(withFlag.status, 0, withFlag.stderr);
    const withFlagResult = listJsonLinesOfProgramOutput(withFlag.stdout).filter((printedLine) => "startAt" in printedLine)[0]!;
    assert.equal(withFlagResult.outcome, InverseStepOutcome.NoOlderChange);
    const repoFolder = getInverseRepoFolderForFile(passedProject.storeFolder, passedProject.projectFolder, passedProject.file);
    assert.equal(readWalkCoverage(repoFolder)!.isFinished, true);
});

test("test_cli_pass_stops_without_startAt_exits_with_the_usage_text", (t) => {
    // Scenario: --pass-stops is given and --startAt is not.
    const spawned = runStepProgram(writeScriptStopProject(t), ["--pass-stops"], "q\n");
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

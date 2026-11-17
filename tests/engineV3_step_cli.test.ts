// The command-line step program: command lines in, one JSON line per output.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InverseStepEngine, InverseStepOutcome, StepCommand } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { FileEventType, type FileEvent } from "../engineV3/engineV3_replay_reverse_events.ts";
import { listInverseCommits, type InverseCommit } from "../engineV3/engineV3_inverse_repo.ts";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { parseStepCommand, runStepCommands, type StepCliSession } from "../engineV3/engineV3_step_cli.ts";
import { SESSION_A } from "./multi-source-test-helpers.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const JFRED_FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROGRAM_FILE = "engineV3/engineV3_inverse_repos_for_project.ts";
const PROJECT_FILE_NAME = "a.txt";
const TWO_EDIT_DISK_TEXT = "three\n";
const UNFITTING_EDIT_DISK_TEXT = "abc\n";
const PROGRAM_TIMEOUT_MILLISECONDS = 110000;

type PrintedLine = Record<string, unknown>;
type Project = { rootFolder: string; projectFolder: Path; jsonlsFolder: Path; snapshotFolder: Path; storeFolder: Path; secondStoreFolder: Path; file: Path };

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEditRows(projectFolder: string, toolUseId: string, filePath: string, oldString: string, newString: string, originalFile: string | null, second: number): object[] {
    const toolUseResult = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false, originalFile };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: filePath }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, sessionId: SESSION_A, cwd: projectFolder, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

// The layered search of the program needs a repo with a HEAD commit; the file stays untracked.
function initGitRepo(folder: string): void {
    execFileSync("git", ["init", "-q"], { cwd: folder });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: folder });
}

// A git project holding a.txt with the given disk text, and a log folder holding one transcript made of the rows.
function writeProject(t: TestContext, diskText: string, makeRows: (projectFolder: string, filePath: string) => object[]): Project {
    const rootFolder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-step-cli-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const snapshotFolder = join(rootFolder, "file-history");
    mkdirSync(projectFolder);
    mkdirSync(jsonlsFolder);
    mkdirSync(snapshotFolder);
    initGitRepo(projectFolder);
    const filePath = join(projectFolder, PROJECT_FILE_NAME);
    writeFileSync(filePath, diskText);
    const rows = makeRows(projectFolder, filePath);
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    return {
        rootFolder,
        projectFolder: new Path(projectFolder),
        jsonlsFolder: new Path(jsonlsFolder),
        snapshotFolder: new Path(snapshotFolder),
        storeFolder: new Path(join(rootFolder, "store")),
        secondStoreFolder: new Path(join(rootFolder, "second-store")),
        file: new Path(filePath),
    };
}

// Disk text "three"; Edit one to two at second 10, Edit two to three at second 20: two forward steps write text.
function writeTwoEditProject(t: TestContext): Project {
    return writeProject(t, TWO_EDIT_DISK_TEXT, (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
}

// Disk text "abc"; the Edit changes "q" to "Z" and the log does not hold the file text before it: it fits neither way.
function writeUnfittingEditProject(t: TestContext): Project {
    return writeProject(t, UNFITTING_EDIT_DISK_TEXT, (projectFolder, filePath) => makeEditRows(projectFolder, "toolu_q", filePath, "q", "Z", null, 10));
}

function makeProjectFiles(project: Project): ProjectFile[] {
    return [{ file: project.file, transcriptFile: project.file }];
}

function makeSession(project: Project, storeFolder: Path): StepCliSession {
    const projectFiles = makeProjectFiles(project);
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    const fileName = basename(project.file.toString());
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    return { repoFolder, fileName, relativeFile: PROJECT_FILE_NAME, events, step };
}

async function* makeCommandLines(lines: string[]): AsyncIterable<string> {
    for (const line of lines) {
        yield line;
    }
}

async function runAndCapturePrintedLines(t: TestContext, commandLines: string[], session: StepCliSession): Promise<PrintedLine[]> {
    const printedTexts: string[] = [];
    const logMock = t.mock.method(console, "log", (printedText: string) => {
        printedTexts.push(printedText);
    });
    await runStepCommands(makeCommandLines(commandLines), session);
    logMock.mock.restore();
    return printedTexts.map((printedText) => JSON.parse(printedText) as PrintedLine);
}

function listStepLines(printedLines: PrintedLine[]): PrintedLine[] {
    return printedLines.filter((printedLine) => "step" in printedLine);
}

function listStoredCommits(session: StepCliSession): InverseCommit[] {
    return listInverseCommits(session.repoFolder, session.fileName, false);
}

function runProgram(project: Project, storeFolder: Path, extraArguments: string[], inputText: string): { status: number | null; stdout: string; stderr: string } {
    const programArguments = [
        "--import", "tsx", PROGRAM_FILE,
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", storeFolder.toString(),
        "--step", PROJECT_FILE_NAME,
        ...extraArguments,
    ];
    const spawned = spawnSync(process.execPath, programArguments, { input: inputText, cwd: JFRED_FOLDER, encoding: "utf8", timeout: PROGRAM_TIMEOUT_MILLISECONDS });
    return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

function listJsonLinesOfProgramOutput(stdout: string): PrintedLine[] {
    return stdout.split("\n").filter((outputLine) => outputLine.startsWith("{")).map((outputLine) => JSON.parse(outputLine) as PrintedLine);
}

function listStoredCommitsOfProject(project: Project, storeFolder: Path): InverseCommit[] {
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    return listInverseCommits(repoFolder, PROJECT_FILE_NAME, false);
}

test("test_the_line_f_and_the_line_forward_both_mean_step_forward", () => {
    // Scenario: the short line and the long line name the same command.
    // The line "f" parses to the forward command.
    assert.equal(parseStepCommand("f"), StepCommand.Forward);
    // The line "forward" parses to the forward command.
    assert.equal(parseStepCommand("forward"), StepCommand.Forward);
});

test("test_parseStepCommand_maps_r_and_replay_to_the_replay_command", () => {
    // Scenario: the short line and the long line name the replay command.
    // The line "r" parses to the replay command.
    assert.equal(parseStepCommand("r"), StepCommand.Replay);
    // The line "replay" parses to the replay command.
    assert.equal(parseStepCommand("replay"), StepCommand.Replay);
});

test("test_a_line_that_is_not_a_command_throws", () => {
    // Scenario: a person types a word that is not in the table of commands.
    // Parsing that line throws.
    assert.throws(() => parseStepCommand("go"));
});

test("test_a_forward_step_line_names_outcome_engine_position_and_commit", async (t) => {
    // Scenario: a file with two Edit rows; one forward step, then quit.
    const project = writeTwoEditProject(t);
    const session = makeSession(project, project.storeFolder);
    // Run the lines "f" and "q".
    const printedLines = await runAndCapturePrintedLines(t, ["f", "q"], session);
    // One step line is printed.
    const stepLines = listStepLines(printedLines);
    assert.equal(stepLines.length, 1);
    const stepLine = stepLines[0]!;
    // The step wrote a new text with the backward engine.
    assert.equal(stepLine.outcome, InverseStepOutcome.NewText);
    assert.equal(stepLine.engine, InverseStepEngine.Backward);
    assert.equal(stepLine.file, PROJECT_FILE_NAME);
    // The position and the commit are those of the tip commit of the repo.
    const storedCommits = listStoredCommits(session);
    assert.equal(storedCommits.length, 2);
    const tipCommit = storedCommits[storedCommits.length - 1]!;
    assert.equal(stepLine.position, tipCommit.position);
    assert.equal(stepLine.commit, tipCommit.commitHash.toString());
});

test("test_a_begin_line_comes_before_each_forward_step", async (t) => {
    // Scenario: a file with two Edit rows; two forward steps, then quit.
    const project = writeTwoEditProject(t);
    const session = makeSession(project, project.storeFolder);
    const firstEventIndex = session.step.nextEventIndex;
    // Run the lines "f", "f", "q".
    const printedLines = await runAndCapturePrintedLines(t, ["f", "f", "q"], session);
    // The printed lines alternate: begin, step, begin, step.
    const lineKinds = printedLines.map((printedLine) => Object.keys(printedLine)[0]);
    assert.deepEqual(lineKinds, ["begin", "step", "begin", "step"]);
    // The first begin line says where the walk starts: tip position 0, and the first event to run.
    const firstBeginLine = printedLines[0]!;
    assert.equal(firstBeginLine.begin, 1);
    assert.equal(firstBeginLine.fromPosition, 0);
    assert.equal(firstBeginLine.nextEventIndex, firstEventIndex);
    assert.equal(firstBeginLine.nextEventType, session.events[firstEventIndex]!.type);
});

test("test_a_stop_line_names_the_event_type_and_the_jsonl_line", async (t) => {
    // Scenario: the only Edit row fits neither way.
    const project = writeUnfittingEditProject(t);
    const session = makeSession(project, project.storeFolder);
    // Run the lines "f" and "q".
    const printedLines = await runAndCapturePrintedLines(t, ["f", "q"], session);
    const stepLine = listStepLines(printedLines)[0]!;
    // The step stops: it writes no commit and has no position.
    assert.equal(stepLine.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(stepLine.commit, null);
    assert.equal(stepLine.position, null);
    // The line names the Edit event and the line of the log where that Edit row is.
    assert.equal(stepLine.eventType, FileEventType.EditRow);
    const editEvent = session.events.find((event: FileEvent) => event.type === FileEventType.EditRow)!;
    const expectedSource = `${editEvent.source!.filePath}:${editEvent.source!.lineNumber}`;
    assert.equal(stepLine.source, expectedSource);
    assert.match(String(stepLine.source), /\.jsonl:\d+$/);
});

test("test_backward_moves_the_cursor_back_and_writes_nothing", async (t) => {
    // Scenario: a file with two Edit rows; one step forward, one step backward, then quit.
    const project = writeTwoEditProject(t);
    const session = makeSession(project, project.storeFolder);
    // Run the lines "f", "b", "q".
    const printedLines = await runAndCapturePrintedLines(t, ["f", "b", "q"], session);
    // The backward line is the second numbered line and says moved-back.
    const backwardLine = listStepLines(printedLines)[1]!;
    assert.equal(backwardLine.step, 2);
    assert.equal(backwardLine.outcome, InverseStepOutcome.MovedBack);
    // The cursor is back at position 0, the disk-now commit.
    const storedCommits = listStoredCommits(session);
    assert.equal(backwardLine.position, 0);
    assert.equal(backwardLine.commit, storedCommits[0]!.commitHash.toString());
    // The repo keeps both commits: backward removes nothing and writes nothing.
    assert.equal(storedCommits.length, 2);
});

test("test_backward_with_no_earlier_step_answers_no_newer_change", async (t) => {
    // Scenario: a fresh session, and the first command is backward.
    const project = writeTwoEditProject(t);
    const session = makeSession(project, project.storeFolder);
    // Run the lines "b" and "q".
    const printedLines = await runAndCapturePrintedLines(t, ["b", "q"], session);
    // The answer says there is nothing newer, and the cursor stays at position 0.
    const backwardLine = listStepLines(printedLines)[0]!;
    assert.equal(backwardLine.step, 1);
    assert.equal(backwardLine.outcome, InverseStepOutcome.NoNewerChange);
    assert.equal(backwardLine.position, 0);
    assert.equal(backwardLine.commit, listStoredCommits(session)[0]!.commitHash.toString());
});

test("test_a_restart_resumes_at_the_stored_tip_and_the_next_step_equals_the_unbroken_run", async (t) => {
    // Scenario: store A holds a run of one step; store B holds an unbroken run of two steps.
    const project = writeTwoEditProject(t);
    // In store A: run "f", "q".
    const firstSession = makeSession(project, project.storeFolder);
    await runAndCapturePrintedLines(t, ["f", "q"], firstSession);
    const tipCommitOfFirstRun = listStoredCommits(firstSession)[listStoredCommits(firstSession).length - 1]!;
    // A restart builds a new session from the commits stored in store A: it resumes at the stored tip.
    const restartedSession = makeSession(project, project.storeFolder);
    assert.equal(restartedSession.step.lastWrittenPosition, tipCommitOfFirstRun.position);
    // The restart runs "f", "q".
    const restartedLines = await runAndCapturePrintedLines(t, ["f", "q"], restartedSession);
    const restartedStepLine = listStepLines(restartedLines)[0]!;
    // In store B: run "f", "f", "q" without a break.
    const unbrokenSession = makeSession(project, project.secondStoreFolder);
    const unbrokenLines = await runAndCapturePrintedLines(t, ["f", "f", "q"], unbrokenSession);
    const unbrokenSecondStepLine = listStepLines(unbrokenLines)[1]!;
    // The restart step equals the second step of the unbroken run: same outcome, position and engine.
    assert.equal(restartedStepLine.outcome, unbrokenSecondStepLine.outcome);
    assert.equal(restartedStepLine.position, unbrokenSecondStepLine.position);
    assert.equal(restartedStepLine.engine, unbrokenSecondStepLine.engine);
    // The tip commit of both repos holds the same tree.
    const restartedCommits = listStoredCommits(restartedSession);
    const unbrokenCommits = listStoredCommits(unbrokenSession);
    assert.equal(restartedCommits.length, unbrokenCommits.length);
    assert.equal(restartedCommits[restartedCommits.length - 1]!.treeHash.toString(), unbrokenCommits[unbrokenCommits.length - 1]!.treeHash.toString());
});

test("test_a_restart_after_a_changed_earlier_state_throws", async (t) => {
    // Scenario: one step is stored.
    const project = writeTwoEditProject(t);
    const session = makeSession(project, project.storeFolder);
    await runAndCapturePrintedLines(t, ["f", "q"], session);
    // The restart replays events whose disk text differs from the stored disk-now commit.
    const changedEvents = session.events.map((event: FileEvent) => {
        if (event.type === FileEventType.DiskNow) {
            return { ...event, bytes: TWO_EDIT_DISK_TEXT + "extra line\n" };
        }
        return event;
    });
    const storedCommits = listInverseCommits(session.repoFolder, session.fileName, true);
    // Creating the step throws and tells the person to start again from now.
    assert.throws(() => createFileStep(changedEvents, storedCommits), /does not match the replayed state: start again from now/);
});

test("test_the_from_now_flag_removes_the_repo_and_starts_at_position_0", (t) => {
    // Scenario: the program ran one step, so the repo holds 2 commits.
    const project = writeTwoEditProject(t);
    const firstRun = runProgram(project, project.storeFolder, [], "f\nq\n");
    assert.equal(firstRun.status, 0, firstRun.stderr);
    assert.equal(listStoredCommitsOfProject(project, project.storeFolder).length, 2);
    // The program runs again with --from-now and the line "q".
    const secondRun = runProgram(project, project.storeFolder, ["--from-now"], "q\n");
    assert.equal(secondRun.status, 0, secondRun.stderr);
    // The repo holds exactly 1 commit, at position 0.
    const storedCommits = listStoredCommitsOfProject(project, project.storeFolder);
    assert.equal(storedCommits.length, 1);
    assert.equal(storedCommits[0]!.position, 0);
});

test("test_the_program_prints_a_resume_line_first_when_the_repo_already_has_commits", (t) => {
    // Scenario: the program ran one step, so the repo holds 2 commits.
    const project = writeTwoEditProject(t);
    const firstRun = runProgram(project, project.storeFolder, [], "f\nq\n");
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const storedCommits = listStoredCommitsOfProject(project, project.storeFolder);
    const tipCommit = storedCommits[storedCommits.length - 1]!;
    // The program runs again on the same store with the lines "f" and "q".
    const secondRun = runProgram(project, project.storeFolder, [], "f\nq\n");
    assert.equal(secondRun.status, 0, secondRun.stderr);
    // The first JSON line is the resume line with the tip of the first run.
    const firstJsonLine = listJsonLinesOfProgramOutput(secondRun.stdout)[0]!;
    assert.deepEqual(firstJsonLine, { resume: true, position: tipCommit.position, commit: tipCommit.commitHash.toString() });
});

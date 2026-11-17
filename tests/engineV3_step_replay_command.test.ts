// The r command of step mode: its refusals and guards, all reached before the docker check, so no test here needs docker.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { appendFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { InverseStepEngine, InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { StateConfidence } from "../engineV3/engineV3_file_known_states.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildInverseReposForFiles, buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { listProjectFilesOnDiskAndInLogs } from "../engineV3/engineV3_inverse_repos_project_files.ts";
import { runStepCommands, type StepCliSession } from "../engineV3/engineV3_step_cli.ts";
import { formatReplayedLine, formatReplayRefusalLine } from "../engineV3/engineV3_step_replay_command.ts";
import { walkOtherFilesToTheEnd } from "../engineV3/engineV3_step_other_files.ts";
import { makeBashRows, makeEditRows, makeWriteCreateRows, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const STEPPED_FILE_NAME = "a.txt";
const OTHER_FILE_NAME = "b.txt";
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const JFRED_FOLDER = join(import.meta.dirname, "..");
const PROGRAM_FILE = "engineV3/engineV3_inverse_repos_for_project.ts";
const PROGRAM_TIMEOUT_MILLISECONDS = 110000;
const PRESS_F_FIRST_REASON = /press f first/;

type PrintedLine = Record<string, unknown>;
type CapturedOutput = { printedLines: PrintedLine[]; stderrTexts: string[] };

function makeStoreFolderInsideCacheFolder(t: TestContext): Path {
    const storeFolder = join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-" + randomUUID());
    mkdirSync(storeFolder, { recursive: true });
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    return new Path(storeFolder);
}

function captureOutput(t: TestContext): CapturedOutput {
    const capturedOutput: CapturedOutput = { printedLines: [], stderrTexts: [] };
    t.mock.method(console, "log", (printedText: string) => {
        capturedOutput.printedLines.push(JSON.parse(printedText) as PrintedLine);
    });
    t.mock.method(process.stderr, "write", (writtenText: string) => {
        capturedOutput.stderrTexts.push(writtenText);
        return true;
    });
    return capturedOutput;
}

async function* makeCommandLines(lines: string[]): AsyncIterable<string> {
    for (const line of lines) {
        yield line;
    }
}

// The session the program builds at start, with a replay context made by hand.
function makeSessionWithReplayContext(project: ProjectWithFiles, storeFolder: Path): StepCliSession {
    const stepProjectFile: ProjectFile = { file: project.fileByName.get(STEPPED_FILE_NAME)!, transcriptFile: project.fileByName.get(STEPPED_FILE_NAME)! };
    const transcriptsToParse = [project.jsonlsFolder];
    buildOnDemandInverseReposForFiles(project.projectFolder, [stepProjectFile], transcriptsToParse, storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader([stepProjectFile], transcriptsToParse, [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, stepProjectFile.file);
    const fileName = basename(stepProjectFile.file.toString());
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    const replay = { projectFolder: project.projectFolder, jsonlsFolder: project.jsonlsFolder, transcriptsToParse, fileHistoryFolder: project.snapshotFolder, storeFolder, stepProjectFile, replayFiles: undefined, walkedOtherFiles: undefined };
    return { repoFolder, fileName, relativeFile: STEPPED_FILE_NAME, events, step, replay };
}

function listCommitSummaries(repoFolder: Path, fileName: string): string[] {
    return listInverseCommits(repoFolder, fileName, true).map((inverseCommit) => `${inverseCommit.commitHash.toString()} ${inverseCommit.position} ${inverseCommit.text}`);
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

function findLineByOutcome(printedLines: PrintedLine[], outcome: InverseStepOutcome): PrintedLine {
    return printedLines.find((printedLine) => printedLine.outcome === outcome)!;
}

// Disk "v1": a Write of "v0" at second 10, then a script at second 20 that writes "v1" into a.txt.
function writeScriptStopProject(t: TestContext): ProjectWithFiles {
    return writeProjectFiles(t, new Map([[STEPPED_FILE_NAME, "v1\n"]]), (projectFolder, filePathByFileName) => {
        const steppedPath = filePathByFileName.get(STEPPED_FILE_NAME)!;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_w1", steppedPath, "v0\n", 10),
            ...makeBashRows(projectFolder, "toolu_s1", `printf 'v1\\n' > ${steppedPath}`, 20),
        ];
    });
}

// Like writeScriptStopProject, with b.txt as a second file of the replay list.
function writeScriptStopProjectWithOtherFile(t: TestContext): ProjectWithFiles {
    const diskTextByFileName = new Map([[STEPPED_FILE_NAME, "v1\n"], [OTHER_FILE_NAME, "b1\n"]]);
    return writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const steppedPath = filePathByFileName.get(STEPPED_FILE_NAME)!;
        const otherPath = filePathByFileName.get(OTHER_FILE_NAME)!;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_w1", steppedPath, "v0\n", 10),
            ...makeBashRows(projectFolder, "toolu_s1", `printf 'v1\\n' > ${steppedPath}`, 20),
            ...makeWriteCreateRows(projectFolder, "toolu_b1", otherPath, "b0\n", 12),
            ...makeEditRows(projectFolder, "toolu_b2", otherPath, "b0", "b1", "b0\n", 22),
        ];
    });
}

test("test_r_before_any_stop_prints_a_refusal_and_writes_nothing", async (t) => {
    // Scenario: a fresh session, and the first command is r.
    const project = writeScriptStopProject(t);
    const session = makeSessionWithReplayContext(project, makeStoreFolderInsideCacheFolder(t));
    const commitsBefore = listCommitSummaries(session.repoFolder, session.fileName);
    const capturedOutput = captureOutput(t);
    // Run the lines "r" and "q".
    await runStepCommands(makeCommandLines(["r", "q"]), session);
    // One line is printed: a refusal that tells the person to press f first.
    assert.equal(capturedOutput.printedLines.length, 1);
    const refusalLine = capturedOutput.printedLines[0]!;
    assert.equal(refusalLine.step, 1);
    assert.equal(refusalLine.file, STEPPED_FILE_NAME);
    assert.equal(refusalLine.outcome, InverseStepOutcome.ReplayRefused);
    assert.equal(refusalLine.engine, InverseStepEngine.Replay);
    assert.match(String(refusalLine.reason), PRESS_F_FIRST_REASON);
    assert.equal(refusalLine.source, null);
    // The commit list of the repo is unchanged.
    assert.deepEqual(listCommitSummaries(session.repoFolder, session.fileName), commitsBefore);
});

test("test_r_after_a_stop_on_an_edit_prints_a_refusal", async (t) => {
    // Scenario: the only Edit row fits neither way, so the stop is on an Edit.
    const project = writeProjectFiles(t, new Map([[STEPPED_FILE_NAME, "abc\n"]]), (projectFolder, filePathByFileName) => {
        return makeEditRows(projectFolder, "toolu_q", filePathByFileName.get(STEPPED_FILE_NAME)!, "q", "Z", null, 10);
    });
    const session = makeSessionWithReplayContext(project, makeStoreFolderInsideCacheFolder(t));
    const capturedOutput = captureOutput(t);
    // Run the lines "f", "r" and "q".
    await runStepCommands(makeCommandLines(["f", "r", "q"]), session);
    // The f line is a stop on the Edit and the r line refuses.
    const stopLine = findLineByOutcome(capturedOutput.printedLines, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(stopLine.eventType, FileEventType.EditRow);
    const refusalLine = findLineByOutcome(capturedOutput.printedLines, InverseStepOutcome.ReplayRefused);
    assert.match(String(refusalLine.reason), PRESS_F_FIRST_REASON);
    // The refusal names the source of the stop.
    assert.equal(refusalLine.source, stopLine.source);
    assert.notEqual(refusalLine.source, null);
});

// Needs 7c: the program context is passed to the loop only by the entry block of engineV3_inverse_repos_for_project.ts.
test("test_r_with_a_store_outside_the_cache_folder_throws", (t) => {
    // Scenario: the program runs on a store in the temp folder, f stops on the script, then r.
    const project = writeScriptStopProject(t);
    const storeFolder = join(tmpdir(), "jfred-test-outside-" + randomUUID());
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    const programArguments = [
        "--import", "tsx", PROGRAM_FILE,
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", storeFolder,
        "--step", STEPPED_FILE_NAME,
    ];
    const spawned = spawnSync(process.execPath, programArguments, { input: "f\nr\nq\n", cwd: JFRED_FOLDER, encoding: "utf8", timeout: PROGRAM_TIMEOUT_MILLISECONDS });
    // The program exits with an error and names the store that is outside the cache folder.
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, /is not inside the cache folder/);
    // The crash line is printed.
    const printedLines = spawned.stdout.split("\n").filter((outputLine) => outputLine.startsWith("{")).map((outputLine) => JSON.parse(outputLine) as PrintedLine);
    assert.equal(printedLines.some((printedLine) => "crashedAt" in printedLine), true);
});

test("test_r_with_a_javascript_script_prints_the_refusal_and_starts_no_docker", async (t) => {
    // Scenario: a.txt has a Write of "v0"; x.js is written with a body that names a.txt; the Bash row runs `node x.js`.
    const project = writeProjectFiles(t, new Map([[STEPPED_FILE_NAME, "v1\n"]]), (projectFolder, filePathByFileName) => {
        const steppedPath = filePathByFileName.get(STEPPED_FILE_NAME)!;
        const scriptBody = `require("fs").writeFileSync("${steppedPath}", "x")`;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_w1", steppedPath, "v0\n", 5),
            ...makeWriteCreateRows(projectFolder, "toolu_w2", join(projectFolder, "x.js"), scriptBody, 10),
            ...makeBashRows(projectFolder, "toolu_s1", "node x.js", 20),
        ];
    });
    const session = makeSessionWithReplayContext(project, makeStoreFolderInsideCacheFolder(t));
    const capturedOutput = captureOutput(t);
    // Run the lines "f", "r" and "q".
    await runStepCommands(makeCommandLines(["f", "r", "q"]), session);
    // The f line is a stop on the script and the r line refuses because the script is JavaScript.
    const stopLine = findLineByOutcome(capturedOutput.printedLines, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(stopLine.eventType, FileEventType.ScriptMayWrite);
    const refusalLine = findLineByOutcome(capturedOutput.printedLines, InverseStepOutcome.ReplayRefused);
    assert.match(String(refusalLine.reason), /JavaScript or TypeScript/);
    // The program prints "replaying script" only after the container step, so no such line means no docker.
    assert.equal(capturedOutput.stderrTexts.some((stderrText) => stderrText.includes("replaying script")), false);
});

test("test_r_with_a_full_build_repo_in_the_store_throws", async (t) => {
    // Scenario: the store holds a full-build repo of b.txt, an OTHER file of the replay list.
    const project = writeScriptStopProjectWithOtherFile(t);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    const session = makeSessionWithReplayContext(project, storeFolder);
    const otherFile = project.fileByName.get(OTHER_FILE_NAME)!;
    buildInverseReposForFiles(project.projectFolder, [{ file: otherFile, transcriptFile: otherFile }], [project.jsonlsFolder], [project.snapshotFolder], storeFolder, DISK_NOW_INSTANT, () => {});
    const otherRepoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, otherFile);
    const otherRepoTreeBefore = describeFolderTree(otherRepoFolder.toString());
    captureOutput(t);
    // Run the lines "f" and "r": r throws and names the full-build repo.
    await assert.rejects(runStepCommands(makeCommandLines(["f", "r", "q"]), session), /full-build repo/);
    // The full-build repo is untouched.
    assert.deepEqual(describeFolderTree(otherRepoFolder.toString()), otherRepoTreeBefore);
});

test("test_a_second_r_after_a_refusal_prints_a_refusal", async (t) => {
    // Scenario: the script is JavaScript, so the first r is refused; the second r follows at once.
    const project = writeProjectFiles(t, new Map([[STEPPED_FILE_NAME, "v1\n"]]), (projectFolder, filePathByFileName) => {
        const steppedPath = filePathByFileName.get(STEPPED_FILE_NAME)!;
        const scriptBody = `require("fs").writeFileSync("${steppedPath}", "x")`;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_w1", steppedPath, "v0\n", 5),
            ...makeWriteCreateRows(projectFolder, "toolu_w2", join(projectFolder, "x.js"), scriptBody, 10),
            ...makeBashRows(projectFolder, "toolu_s1", "node x.js", 20),
        ];
    });
    const session = makeSessionWithReplayContext(project, makeStoreFolderInsideCacheFolder(t));
    const capturedOutput = captureOutput(t);
    // Run the lines "f", "r", "r" and "q".
    await runStepCommands(makeCommandLines(["f", "r", "r", "q"]), session);
    // The first r gives the JavaScript refusal; the second r says to press f first, because the first r cleared the stop.
    const refusalLines = capturedOutput.printedLines.filter((printedLine) => printedLine.outcome === InverseStepOutcome.ReplayRefused);
    assert.equal(refusalLines.length, 2);
    assert.match(String(refusalLines[0]!.reason), /JavaScript or TypeScript/);
    assert.match(String(refusalLines[1]!.reason), PRESS_F_FIRST_REASON);
});

test("test_r_after_the_logs_grew_refuses_and_changes_no_repo", async (t) => {
    // Scenario: a.txt is stepped; b.txt has a finished repo made by the walker; then the log file grows by one line.
    const project = writeScriptStopProjectWithOtherFile(t);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    const session = makeSessionWithReplayContext(project, storeFolder);
    const stepProjectFile = session.replay!.stepProjectFile;
    const replayFiles = listProjectFilesOnDiskAndInLogs(project.projectFolder, [project.jsonlsFolder]);
    walkOtherFilesToTheEnd({ projectFolder: project.projectFolder, replayFiles, replayedProjectFile: stepProjectFile, storeFolder, transcriptsToParse: [project.jsonlsFolder], fileHistoryFolder: project.snapshotFolder, reportProgress: () => {} });
    const repoFolders = replayFiles.map((projectFile) => getInverseRepoFolderForFile(storeFolder, project.projectFolder, projectFile.file));
    const listRepoStates = (): { commits: string[]; tree: string[] }[] => repoFolders.map((repoFolder, index) => {
        return { commits: listCommitSummaries(repoFolder, basename(replayFiles[index]!.file.toString())), tree: describeFolderTree(repoFolder.toString()) };
    });
    const logFile = join(project.jsonlsFolder.toString(), "s1.jsonl");
    let repoStatesBefore: { commits: string[]; tree: string[] }[] = [];
    let repoStatesAfter: { commits: string[]; tree: string[] }[] = [];
    async function* makeCommandLinesWithGrowingLog(): AsyncIterable<string> {
        yield "f";
        appendFileSync(logFile, JSON.stringify(makeBashRows(project.projectFolder.toString(), "toolu_grow", "echo grown", 30)[0]) + "\n");
        repoStatesBefore = listRepoStates();
        yield "r";
        repoStatesAfter = listRepoStates();
        yield "q";
    }
    const capturedOutput = captureOutput(t);
    await runStepCommands(makeCommandLinesWithGrowingLog(), session);
    // The r line is a refusal that names the first file of the replay list, whose repo no longer matches the logs.
    const refusalLine = findLineByOutcome(capturedOutput.printedLines, InverseStepOutcome.ReplayRefused);
    const firstStaleFile = replayFiles[0]!;
    assert.match(String(refusalLine.reason), new RegExp(`the repo of ${basename(firstStaleFile.file.toString())} no longer matches the logs or the disk`));
    // For both repos the commit list and the folder tree are equal before and after r: nothing was wiped and nothing was rebuilt.
    assert.equal(repoStatesBefore.length, 2);
    assert.deepEqual(repoStatesAfter, repoStatesBefore);
});

function spawnStepProgram(project: ProjectWithFiles, storeFolder: Path, stepFileName: string, inputLines: string[]): SpawnSyncReturns<string> {
    const programArguments = [
        "--import", "tsx", PROGRAM_FILE,
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", storeFolder.toString(),
        "--step", stepFileName,
    ];
    return spawnSync(process.execPath, programArguments, { input: inputLines.join("\n") + "\n", cwd: JFRED_FOLDER, encoding: "utf8", timeout: PROGRAM_TIMEOUT_MILLISECONDS });
}

test("test_the_program_start_with_a_full_build_repo_of_the_stepped_file_throws_before_wiping_it", (t) => {
    // Scenario: the store holds a full-build repo of a.txt, then the program starts with --step a.txt.
    const project = writeScriptStopProject(t);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    const steppedFile = project.fileByName.get(STEPPED_FILE_NAME)!;
    buildInverseReposForFiles(project.projectFolder, [{ file: steppedFile, transcriptFile: steppedFile }], [project.jsonlsFolder], [project.snapshotFolder], storeFolder, DISK_NOW_INSTANT, () => {});
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, steppedFile);
    const repoTreeBefore = describeFolderTree(repoFolder.toString());
    // Start the program and quit at once.
    const spawned = spawnStepProgram(project, storeFolder, STEPPED_FILE_NAME, ["q"]);
    // The program exits with an error that names the full-build repo.
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, /full-build repo/);
    // The repo folder is equal to before: nothing was wiped.
    assert.deepEqual(describeFolderTree(repoFolder.toString()), repoTreeBefore);
});

test("test_the_step_program_start_gives_a_copy_born_file_the_same_states_as_the_walker", (t) => {
    // Scenario: src.txt is "s1" then "s2"; at second 30 `cp src.txt copy.txt` runs; copy.txt differs on disk.
    const diskTextByFileName = new Map<string, string>([[STEPPED_FILE_NAME, "a\n"], ["src.txt", "s2\n"], ["copy.txt", "disk-differs\n"]]);
    const project = writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const sourcePath = filePathByFileName.get("src.txt")!;
        const copyPath = filePathByFileName.get("copy.txt")!;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_s1", sourcePath, "s1\n", 10),
            ...makeEditRows(projectFolder, "toolu_s2", sourcePath, "s1", "s2", "s1\n", 20),
            ...makeBashRows(projectFolder, "toolu_c1", `cp ${sourcePath} ${copyPath}`, 30),
        ];
    });
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    // The program steps copy.txt with f to the end.
    const spawned = spawnStepProgram(project, storeFolder, "copy.txt", [...Array(10).fill("f"), "q"]);
    assert.equal(spawned.status, 0, spawned.stderr);
    const copyFile = project.fileByName.get("copy.txt")!;
    const copyRepoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, copyFile);
    const commitsFromProgram = listCommitSummaries(copyRepoFolder, "copy.txt");
    // The born state of copy.txt holds the text of src.txt just before the copy.
    assert.equal(listInverseCommits(copyRepoFolder, "copy.txt", true).some((inverseCommit) => inverseCommit.text === "s2\n"), true);
    // The walker runs on the same store with a.txt as the replayed file: it does not throw and it adds no commit.
    const replayFiles = listProjectFilesOnDiskAndInLogs(project.projectFolder, [project.jsonlsFolder]);
    const stepProjectFile: ProjectFile = { file: project.fileByName.get(STEPPED_FILE_NAME)!, transcriptFile: project.fileByName.get(STEPPED_FILE_NAME)! };
    walkOtherFilesToTheEnd({ projectFolder: project.projectFolder, replayFiles, replayedProjectFile: stepProjectFile, storeFolder, transcriptsToParse: [project.jsonlsFolder], fileHistoryFolder: project.snapshotFolder, reportProgress: () => {} });
    assert.deepEqual(listCommitSummaries(copyRepoFolder, "copy.txt"), commitsFromProgram);
});

test("test_formatReplayRefusalLine_and_formatReplayedLine_print_the_plan_fields", () => {
    // Scenario: one refusal line and one done line are formatted.
    const refusalLine = JSON.parse(formatReplayRefusalLine(3, "a.txt", "s1.jsonl:4", "no way")) as PrintedLine;
    // The refusal line has the step, the file, the outcome, the engine, the reason and the source.
    assert.deepEqual(refusalLine, { step: 3, file: "a.txt", outcome: InverseStepOutcome.ReplayRefused, engine: InverseStepEngine.Replay, reason: "no way", source: "s1.jsonl:4" });
    const replayedLine = JSON.parse(formatReplayedLine({ stepNumber: 4, relativeFile: "a.txt", confidence: StateConfidence.Proven, positions: [1, 2], commit: "abc", instant: new Date(Date.UTC(2026, 0, 1)), source: "s1.jsonl:4", tasks: [{ taskId: "toolu_1", exitCode: 0, timedOut: false }] })) as PrintedLine;
    // The done line holds the ascending positions, the tip position, the tip commit and the tasks.
    assert.deepEqual(replayedLine, { step: 4, file: "a.txt", outcome: InverseStepOutcome.Replayed, engine: InverseStepEngine.Replay, confidence: "proven", positions: [1, 2], position: 2, commit: "abc", instant: "2026-01-01T00:00:00.000Z", eventType: FileEventType.ScriptMayWrite, source: "s1.jsonl:4", tasks: [{ taskId: "toolu_1", exitCode: 0, timedOut: false }], changedLabels: [] });
});

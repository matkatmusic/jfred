// The r command of step mode with a real container: every test here starts docker, so none of them lives in tests/.

import assert from "node:assert/strict";
import { test, before, after, type TestContext } from "node:test";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InverseStepEngine, InverseStepOutcome, ToolName } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { StateConfidence, listKnownStatesForFile } from "./engineV3_file_known_states.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile } from "./engineV3_inverse_repos_for_project.ts";
import { FileEventType, createEvent, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { DockerReadiness, checkDockerReadiness, removeScriptReplayContainers } from "./engineV3_script_replay_container.ts";
import { convertScriptRunToTaskRecord, listReplayGapsFromStates } from "./engineV3_script_replay_gaps.ts";
import { replaySingleGapInContainer } from "./engineV3_script_replay_run.ts";
import { ScriptReplayTaskReason, type ScriptReplayTask } from "./engineV3_script_replay_tasks.ts";
import { ReplayWorkspace } from "./engineV3_script_replay_workspace.ts";
import { PROJECT_FILE_NAME, makeBashRows, makeInstant, makeWriteCreateRows, writeProject, type Project } from "../tests/engineV3_step_test_projects.ts";

const TEST_CONTAINER_PREFIX = `jfred-replay-test-${randomUUID()}-`;
const FAKE_PROJECT_ROOT = `/jfred-test-project/${randomUUID()}`;
const CANARY_FILE_TEXTS = ["canary one\n", "canary two\n", "canary three\n"];
const JFRED_FOLDER = join(import.meta.dirname, "..");
const PROGRAM_FILE = "engineV3/engineV3_inverse_repos_for_project.ts";
const PROGRAM_TIMEOUT_MILLISECONDS = 110000;
const DOCKER_TEST_TIMEOUT_MILLISECONDS = 120000;
const SUCCESS_LIST_FILE = "/tmp/successes.txt";
const PLAY_CHILD_WAIT_MILLISECONDS = 60000;
const CONTAINER_POLL_MILLISECONDS = 500;

type PrintedLine = Record<string, unknown>;

before(() => {
    const readiness = checkDockerReadiness();
    if (readiness !== DockerReadiness.Ready) {
        throw new Error(`Docker is not ready (${readiness}). Run: npm run sandbox:build`);
    }
});

after(() => {
    removeScriptReplayContainers(TEST_CONTAINER_PREFIX);
});

function makeStoreFolderInsideCacheFolder(t: TestContext): Path {
    const storeFolder = join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-" + randomUUID());
    mkdirSync(storeFolder, { recursive: true });
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    return new Path(storeFolder);
}

function spawnStepProgram(project: Project, storeFolder: Path, inputLines: string[]): SpawnSyncReturns<string> {
    const programArguments = [
        "--import", "tsx", PROGRAM_FILE,
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", storeFolder.toString(),
        "--step", PROJECT_FILE_NAME,
    ];
    return spawnSync(process.execPath, programArguments, { input: inputLines.join("\n") + "\n", cwd: JFRED_FOLDER, encoding: "utf8", timeout: PROGRAM_TIMEOUT_MILLISECONDS });
}

function listPrintedLines(stdout: string): PrintedLine[] {
    return stdout.split("\n").filter((outputLine) => outputLine.startsWith("{")).map((outputLine) => JSON.parse(outputLine) as PrintedLine);
}

function listStepLines(printedLines: PrintedLine[]): PrintedLine[] {
    return printedLines.filter((printedLine) => "outcome" in printedLine);
}

function findLineByOutcome(printedLines: PrintedLine[], outcome: InverseStepOutcome): PrintedLine {
    return printedLines.find((printedLine) => printedLine.outcome === outcome)!;
}

function listStoredPositions(project: Project, storeFolder: Path): number[] {
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    return listInverseCommits(repoFolder, PROJECT_FILE_NAME, false).map((inverseCommit) => inverseCommit.position);
}

function findStoredText(project: Project, storeFolder: Path, position: number): string | undefined {
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    return listInverseCommits(repoFolder, PROJECT_FILE_NAME, true).find((inverseCommit) => inverseCommit.position === position)!.text;
}

// Disk text as given; a.txt held "v0" at second 10; the script at second 20 is the shell text the maker returns.
function writeScriptStopProject(t: TestContext, diskText: string, makeScriptText: (steppedPath: string, projectFolder: string) => string): Project {
    return writeProject(t, diskText, (projectFolder, steppedPath) => [
        ...makeWriteCreateRows(projectFolder, "toolu_w1", steppedPath, "v0\n", 10),
        ...makeBashRows(projectFolder, "toolu_s1", makeScriptText(steppedPath, projectFolder), 20),
    ]);
}

function makeFolderTreeLines(folder: string, excludedPaths: string[]): string[] {
    const lines: string[] = [];
    for (const entryName of readdirSync(folder).sort()) {
        const entryPath = join(folder, entryName);
        if (!excludedPaths.includes(entryPath)) {
            const entryStat = lstatSync(entryPath);
            if (entryStat.isDirectory()) {
                lines.push(`dir ${entryPath} ${entryStat.mtimeMs}`);
                lines.push(...makeFolderTreeLines(entryPath, excludedPaths));
            } else {
                const fileHash = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
                lines.push(`file ${entryPath} ${entryStat.mtimeMs} ${fileHash}`);
            }
        }
    }
    return lines;
}

function makeCanaryFolder(t: TestContext): string {
    const canaryFolder = join(tmpdir(), `jfred-canary-${randomUUID()}`);
    mkdirSync(canaryFolder);
    t.after(() => rmSync(canaryFolder, { recursive: true, force: true }));
    for (const [index, canaryText] of CANARY_FILE_TEXTS.entries()) {
        writeFileSync(join(canaryFolder, `canary-${index}.txt`), canaryText);
    }
    return canaryFolder;
}

// Every attempt that works appends its path to the success list; the last line puts the list and "v1" into a.txt.
function makeCanaryScriptText(canaryFolder: string, projectFolder: string, steppedPath: string): string {
    const lines = [
        `: > ${SUCCESS_LIST_FILE}`,
        `for index in 0 1 2; do`,
        `    printf x > "${canaryFolder}/canary-$index.txt" && echo "${canaryFolder}/canary-$index.txt" >> ${SUCCESS_LIST_FILE}`,
        `    [ -e "${canaryFolder}/canary-$index.txt" ] && rm -f "${canaryFolder}/canary-$index.txt" && echo "${canaryFolder}/canary-$index.txt" >> ${SUCCESS_LIST_FILE}`,
        `done`,
        `printf x > "${canaryFolder}/new.txt" && echo "${canaryFolder}/new.txt" >> ${SUCCESS_LIST_FILE}`,
        `mkdir -p "${canaryFolder}" && echo "${canaryFolder}" >> ${SUCCESS_LIST_FILE}`,
        `printf x > /store/probe.txt && echo /store/probe.txt >> ${SUCCESS_LIST_FILE}`,
        `EXISTING_STORE_FILE=$(find /store -type f | head -n 1)`,
        `[ -n "$EXISTING_STORE_FILE" ] || echo NO-STORE-FILE-FOUND >> ${SUCCESS_LIST_FILE}`,
        `printf x >> "$EXISTING_STORE_FILE" && echo "$EXISTING_STORE_FILE" >> ${SUCCESS_LIST_FILE}`,
        `find / -type f -writable -not -path '/proc/*' -not -path '/sys/*' -not -path '/dev/*' -not -path '/tmp/*' -not -path '${projectFolder}/*' -exec sh -c ': > "$0" && echo "$0" >> ${SUCCESS_LIST_FILE}' {} \\;`,
        `find / -type f -writable -not -path '/proc/*' -not -path '/sys/*' -not -path '/dev/*' -not -path '/tmp/*' -not -path '${projectFolder}/*' -exec sh -c 'rm -f "$0" && echo "$0" >> ${SUCCESS_LIST_FILE}' {} \\;`,
        `{ cat ${SUCCESS_LIST_FILE}; echo v1; } > ${steppedPath}`,
    ];
    return lines.join("\n");
}

type HostSnapshot = { canaryLines: string[]; projectLines: string[]; snapshotFolderLines: string[]; jsonlsLines: string[]; storeLines: string[]; tmpFolderNames: string[] };

function takeHostSnapshot(canaryFolder: string, project: Project, storeFolder: Path, repoFolder: Path): HostSnapshot {
    return {
        canaryLines: makeFolderTreeLines(canaryFolder, []),
        projectLines: makeFolderTreeLines(project.projectFolder.toString(), [join(project.projectFolder.toString(), ".git")]),
        snapshotFolderLines: makeFolderTreeLines(project.snapshotFolder.toString(), []),
        jsonlsLines: makeFolderTreeLines(project.jsonlsFolder.toString(), []),
        storeLines: makeFolderTreeLines(storeFolder.toString(), [repoFolder.toString()]),
        tmpFolderNames: readdirSync(tmpdir()).sort(),
    };
}

function listContainerIdsOfStepReplay(): string {
    const containerListing = spawnSync("docker", ["ps", "-aq", "--filter", "name=^/jfred-replay-"], { encoding: "utf8" });
    assert.equal(containerListing.status, 0, containerListing.stderr);
    return containerListing.stdout.trim();
}

function makeDiskNowEvent(text: string): FileEvent {
    return createEvent(FileEventType.DiskNow, undefined, undefined, { bytes: text });
}

function makeWriteEvent(second: number, content: string): FileEvent {
    const source = { filePath: "/logs/session.jsonl", lineNumber: second };
    const row = { toolName: ToolName.Write as const, timestamp: makeInstant(second), source, isCreate: true, content, originalFile: undefined };
    return createEvent(FileEventType.WriteRow, makeInstant(second), source, { row });
}

test("test_r_fills_the_gap_of_a_script_stop_and_prints_engine_replay_proven", { timeout: DOCKER_TEST_TIMEOUT_MILLISECONDS }, (t) => {
    // Scenario: a.txt is "v0" at second 10, a script writes "v1" at second 20, and the disk holds "v1".
    const project = writeScriptStopProject(t, "v1\n", (steppedPath) => `printf 'v1\\n' > ${steppedPath}`);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    // Run the lines "f", "r", "f" and "q".
    const spawned = spawnStepProgram(project, storeFolder, ["f", "r", "f", "q"]);
    assert.equal(spawned.status, 0, spawned.stderr);
    const printedLines = listPrintedLines(spawned.stdout);
    const stepLines = listStepLines(printedLines);
    // The first step line is the stop on the script.
    assert.equal(stepLines[0]!.outcome, InverseStepOutcome.UnknownOrRoadblock);
    assert.equal(stepLines[0]!.eventType, FileEventType.ScriptMayWrite);
    // The r line says replayed, with the replay engine, proven, and the one position it filled.
    const replayedLine = findLineByOutcome(printedLines, InverseStepOutcome.Replayed);
    assert.equal(replayedLine.engine, InverseStepEngine.Replay);
    assert.equal(replayedLine.confidence, StateConfidence.Proven);
    assert.deepEqual(replayedLine.positions, [1]);
    // The program printed the progress line of the container step.
    assert.match(spawned.stderr, /replaying script 1 of 1/);
    // The last f writes position 2, after the replayed position 1.
    assert.equal(stepLines[stepLines.length - 1]!.position, 2);
    assert.deepEqual(listStoredPositions(project, storeFolder), [0, 1, 2]);
    // The commit at position 1 holds the text the script wrote.
    assert.equal(findStoredText(project, storeFolder, 1), "v1\n");
});

test("test_r_after_a_restart_resumes_without_error_and_continues", { timeout: DOCKER_TEST_TIMEOUT_MILLISECONDS }, (t) => {
    // Scenario: the disk holds "v9" while the script writes "v1", so the replayed text differs from the tip text.
    const project = writeScriptStopProject(t, "v9\n", (steppedPath) => `printf 'v1\\n' > ${steppedPath}`);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    // Run 1: the lines "f", "r" and "q".
    const firstRun = spawnStepProgram(project, storeFolder, ["f", "r", "q"]);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    // The r line is replayed and derived.
    const replayedLine = findLineByOutcome(listPrintedLines(firstRun.stdout), InverseStepOutcome.Replayed);
    assert.equal(replayedLine.confidence, StateConfidence.Derived);
    assert.deepEqual(listStoredPositions(project, storeFolder), [0, 1]);
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    const tipCommit = listInverseCommits(repoFolder, PROJECT_FILE_NAME, false).at(-1)!;
    // Run 2 on the same store, with no --from-now: the lines "f" and "q".
    const secondRun = spawnStepProgram(project, storeFolder, ["f", "q"]);
    assert.equal(secondRun.status, 0, secondRun.stderr);
    // The first line of run 2 is the resume line with the tip of run 1.
    const secondRunLines = listPrintedLines(secondRun.stdout);
    assert.deepEqual(secondRunLines[0], { resume: true, position: tipCommit.position, commit: tipCommit.commitHash.toString() });
    // The f of run 2 writes position 2.
    assert.equal(listStepLines(secondRunLines)[0]!.position, 2);
    assert.deepEqual(listStoredPositions(project, storeFolder), [0, 1, 2]);
});

test("test_a_script_that_exits_with_an_error_writes_nothing", { timeout: DOCKER_TEST_TIMEOUT_MILLISECONDS }, (t) => {
    // Scenario: the script writes "v1" and then exits with code 3.
    const project = writeScriptStopProject(t, "v1\n", (steppedPath) => `printf 'v1\\n' > ${steppedPath}; exit 3`);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    // Run the lines "f", "r" and "q".
    const spawned = spawnStepProgram(project, storeFolder, ["f", "r", "q"]);
    assert.equal(spawned.status, 0, spawned.stderr);
    // The r line is a refusal that names exit code 3.
    const refusalLine = findLineByOutcome(listPrintedLines(spawned.stdout), InverseStepOutcome.ReplayRefused);
    assert.equal(refusalLine.engine, InverseStepEngine.Replay);
    assert.match(String(refusalLine.reason), /exited with code 3/);
    // The repo list is unchanged: only the disk-now position.
    assert.deepEqual(listStoredPositions(project, storeFolder), [0]);
});

test("test_script_cannot_change_the_host_canary_folder_through_the_r_command", { timeout: DOCKER_TEST_TIMEOUT_MILLISECONDS }, (t) => {
    // Scenario: the script tries to write into the host canary folder, the store and every writable file of the container.
    const canaryFolder = makeCanaryFolder(t);
    const project = writeScriptStopProject(t, "v9\n", (steppedPath, projectFolder) => makeCanaryScriptText(canaryFolder, projectFolder, steppedPath));
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    const repoFolder = getInverseRepoFolderForFile(storeFolder, project.projectFolder, project.file);
    // The host is snapshotted before the program runs; the repo of a.txt is left out because the program writes there.
    const snapshotBefore = takeHostSnapshot(canaryFolder, project, storeFolder, repoFolder);
    // Run the lines "f", "r" and "q".
    const spawned = spawnStepProgram(project, storeFolder, ["f", "r", "q"]);
    assert.equal(spawned.status, 0, spawned.stderr);
    // The r line is replayed and derived: the container survived its own failed writes.
    const replayedLine = findLineByOutcome(listPrintedLines(spawned.stdout), InverseStepOutcome.Replayed);
    assert.equal(replayedLine.confidence, StateConfidence.Derived);
    // The text at position 1 ends with the line v1; every line before it is empty or starts with the project root.
    const replayedText = findStoredText(project, storeFolder, 1)!;
    const replayedLines = replayedText.split("\n");
    assert.equal(replayedLines[replayedLines.length - 1], "");
    assert.equal(replayedLines[replayedLines.length - 2], "v1");
    const successLines = replayedLines.slice(0, -2).filter((replayedLineText) => replayedLineText !== "");
    assert.deepEqual(successLines.filter((successLine) => !successLine.startsWith(`${project.projectFolder.toString()}/`)), []);
    // The host snapshot is equal after the run.
    assert.deepEqual(takeHostSnapshot(canaryFolder, project, storeFolder, repoFolder), snapshotBefore);
    // No replay container is left.
    assert.equal(listContainerIdsOfStepReplay(), "");
});

test("test_the_start_text_seeds_the_first_script_input_of_the_replayed_file", { timeout: DOCKER_TEST_TIMEOUT_MILLISECONDS }, async (t) => {
    // Scenario: one gap whose start text is "v0" and whose script appends "x" to a.txt.
    const storeFolder = mkdtempSync(join(tmpdir(), "jfred-store-"));
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    const projectFolder = new Path(FAKE_PROJECT_ROOT);
    const replayedFile = new Path(`${FAKE_PROJECT_ROOT}/${PROJECT_FILE_NAME}`);
    const projectFiles = [{ file: replayedFile, transcriptFile: replayedFile }];
    const scriptSource = { filePath: "/logs/session.jsonl", lineNumber: 20 };
    const scriptRun: ScriptRun = { code: `printf 'x\\n' >> ${replayedFile.toString()}`, timestamp: makeInstant(20), cwd: projectFolder, source: scriptSource, toolUseId: new Uuid("toolu_20"), executorKind: ScriptExecutorKind.bash, runInBackground: false };
    const scriptEvent = createEvent(FileEventType.ScriptMayWrite, scriptRun.timestamp, scriptRun.source, { scriptRun });
    const gap = listReplayGapsFromStates(listKnownStatesForFile([makeDiskNowEvent("v0\nx\n"), scriptEvent, makeWriteEvent(10, "v0\n")]))[0]!;
    const task: ScriptReplayTask = { record: convertScriptRunToTaskRecord(scriptRun), instant: scriptRun.timestamp, waitingFiles: [{ relativePath: PROJECT_FILE_NAME, reason: ScriptReplayTaskReason.NamedByFile }] };
    const settings = { projectFolder, recordedProjectFolder: projectFolder, projectFiles, jsonlsFolders: [], snapshotFolders: [], storeFolder: new Path(storeFolder), containerNamePrefix: TEST_CONTAINER_PREFIX };
    // The replayed file has no repo here: its commit list is empty, so the start text is its only input.
    const workspace = new ReplayWorkspace(new Path(storeFolder), projectFolder, projectFolder, projectFiles);
    workspace.setCommits(replayedFile, []);
    // Replay the gap.
    const result = await replaySingleGapInContainer({ settings, workspace, tasks: [task], gap, startText: "v0\n", fileIndex: 0 }, () => {}, new AbortController().signal);
    // The script found "v0" as its input and appended "x" to it.
    assert.equal(result.failureReason, undefined);
    assert.equal(result.textByPosition!.get(gap.droppedStates[0]!.position), "v0\nx\n");
});

function listNewContainerIds(containerIdsBefore: string[]): string[] {
    return listContainerIdsOfStepReplay().split("\n").filter((containerId) => containerId !== "" && !containerIdsBefore.includes(containerId));
}

async function waitUntilNewContainerCountIs(containerIdsBefore: string[], expectedCount: number): Promise<void> {
    const deadlineMilliseconds = Date.now() + PLAY_CHILD_WAIT_MILLISECONDS;
    while (listNewContainerIds(containerIdsBefore).length !== expectedCount) {
        assert.equal(Date.now() < deadlineMilliseconds, true, `the number of new replay containers did not become ${expectedCount}`);
        await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_MILLISECONDS));
    }
}

test("test_a_play_child_that_gets_sigterm_stops_its_container_and_exits", { timeout: DOCKER_TEST_TIMEOUT_MILLISECONDS }, async (t) => {
    // Scenario: the script of the stop sleeps for a long time before it writes "v1".
    const project = writeScriptStopProject(t, "v1\n", (steppedPath) => `sleep 100; printf 'v1\\n' > ${steppedPath}`);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    const containerIdsBefore = listContainerIdsOfStepReplay().split("\n").filter((containerId) => containerId !== "");
    // The play child starts with the lines "f" and "r", and it walks no other file.
    const programArguments = ["--import", "tsx", PROGRAM_FILE, "--project", project.projectFolder.toString(), "--jsonls", project.jsonlsFolder.toString(), "--file-history", project.snapshotFolder.toString(), "--store", storeFolder.toString(), "--step", PROJECT_FILE_NAME, "--no-walk-other-files"];
    const playChild = spawn(process.execPath, programArguments, { cwd: JFRED_FOLDER, stdio: ["pipe", "ignore", "ignore"] });
    t.after(() => playChild.kill("SIGKILL"));
    playChild.stdin.write("f\nr\n");
    // Its container starts.
    await waitUntilNewContainerCountIs(containerIdsBefore, 1);
    // The play child gets SIGTERM.
    const exited = once(playChild, "exit");
    playChild.kill("SIGTERM");
    const [exitCode] = await exited;
    // It exits with a code that is not zero, and its container is gone.
    assert.notEqual(exitCode, 0);
    assert.notEqual(exitCode, null);
    await waitUntilNewContainerCountIs(containerIdsBefore, 0);
});

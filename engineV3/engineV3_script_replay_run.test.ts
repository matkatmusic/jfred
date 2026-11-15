import { test, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { SANDBOX_IMAGE } from "../src/reconstruction_script_sandbox_docker.ts";
import { ScriptExecutorKind } from "../src/reconstruction_script_execution.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { StateConfidence } from "./engineV3_file_known_states.ts";
import { listInverseCommits } from "./engineV3_inverse_repo.ts";
import { buildInverseReposForFiles, getInverseRepoFolderForFile, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import { ScriptInterpreter, ScriptReplayChangeKind, removeScriptReplayContainers } from "./engineV3_script_replay_container.ts";
import type { ScriptReplayTaskRecord } from "./engineV3_script_replay_gaps.ts";
import {
    ScriptTaskOutcomeKind, chooseScriptInterpreter, getScriptReplayRefusal, replayScriptTasksForProject, executeScriptReplayCommandLine,
    type ScriptReplaySettings, type ScriptTaskOutcome,
} from "./engineV3_script_replay_run.ts";

const TEST_CONTAINER_PREFIX = `jfred-replay-test-${randomUUID()}-`;
const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const TO_INSTANT = new Date(Date.UTC(2026, 11, 1, 0, 0, 0));
const DOCKER_TEST_TIMEOUT_MS = 120000;

after(() => {
    removeScriptReplayContainers(TEST_CONTAINER_PREFIX);
});

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

// A call record is stamped one millisecond before its result record.
function makeCallInstant(second: number): Date {
    return new Date(makeInstant(second).getTime() - 1);
}

function makeCallRecord(toolName: string, toolUseId: string, input: object, second: number, cwd: string): object {
    const content = [{ type: "tool_use", id: toolUseId, name: toolName, input, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: makeCallInstant(second).toISOString(), cwd, message: { role: "assistant", content } };
}

function makeResultRecord(toolUseId: string, toolUseResult: object, second: number): object {
    const content = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content }, toolUseResult };
}

function makeWriteCreateRows(toolUseId: string, filePath: string, content: string, second: number, cwd: string): object[] {
    const toolUseResult = { type: "create", filePath, content, originalFile: null, structuredPatch: [], userModified: false };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath, content }, second, cwd), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeWriteUpdateRows(toolUseId: string, filePath: string, content: string, originalFile: string, second: number, cwd: string): object[] {
    const toolUseResult = { type: "update", filePath, content, originalFile, structuredPatch: [], userModified: false };
    return [makeCallRecord("Write", toolUseId, { file_path: filePath, content }, second, cwd), makeResultRecord(toolUseId, toolUseResult, second)];
}

// The result has no originalFile, so the Edit cannot be undone from the text on disk.
function makeEditRowsWithoutOriginalFile(toolUseId: string, filePath: string, oldString: string, newString: string, second: number, cwd: string): object[] {
    const toolUseResult = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false };
    return [makeCallRecord("Edit", toolUseId, { file_path: filePath, old_string: oldString, new_string: newString }, second, cwd), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeBashRecord(toolUseId: string, command: string, second: number, cwd: string): object {
    return makeCallRecord("Bash", toolUseId, { command }, second, cwd);
}

type Scene = { projectFolder: Path; jsonlsFolder: Path; historyFolder: Path; storeFolder: Path; projectFiles: ProjectFile[] };

// A project folder that holds the named files with the given text on disk, no git, and one transcript with the given records.
function makeScene(t: TestContext, diskTextByFileName: Record<string, string>, makeRecords: (projectFolder: string) => object[]): Scene {
    const rootFolder = mkdtempSync(join(tmpdir(), "engine-v3-script-replay-run-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const historyFolder = join(rootFolder, "file-history");
    mkdirSync(projectFolder);
    mkdirSync(jsonlsFolder);
    mkdirSync(historyFolder);
    const projectFiles: ProjectFile[] = [];
    for (const [fileName, diskText] of Object.entries(diskTextByFileName)) {
        const file = new Path(join(projectFolder, fileName));
        writeFileSync(file.toString(), diskText);
        projectFiles.push({ file, transcriptFile: file });
    }
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), makeRecords(projectFolder).map((record) => JSON.stringify(record)).join("\n") + "\n");
    return { projectFolder: new Path(projectFolder), jsonlsFolder: new Path(jsonlsFolder), historyFolder: new Path(historyFolder), storeFolder: new Path(join(rootFolder, "store")), projectFiles };
}

function buildStore(scene: Scene): void {
    buildInverseReposForFiles(scene.projectFolder, scene.projectFiles, [scene.jsonlsFolder], [scene.historyFolder], scene.storeFolder, DISK_NOW_INSTANT, () => {});
}

function makeSettings(scene: Scene): ScriptReplaySettings {
    return {
        projectFolder: scene.projectFolder,
        recordedProjectFolder: scene.projectFolder,
        projectFiles: scene.projectFiles,
        jsonlsFolders: [scene.jsonlsFolder],
        snapshotFolders: [scene.historyFolder],
        storeFolder: scene.storeFolder,
        containerNamePrefix: TEST_CONTAINER_PREFIX,
    };
}

function replayScene(scene: Scene, reportProgress: () => void = () => {}, signal: AbortSignal = new AbortController().signal): Promise<ScriptTaskOutcome[]> {
    return replayScriptTasksForProject(makeSettings(scene), TO_INSTANT, reportProgress, signal);
}

function summarizeCommits(scene: Scene, fileName: string): object[] {
    const repoFolder = getInverseRepoFolderForFile(scene.storeFolder, scene.projectFolder, new Path(join(scene.projectFolder.toString(), fileName)));
    return listInverseCommits(repoFolder, fileName).map((commit) => ({ position: commit.position, confidence: commit.confidence, isFileAbsent: commit.isFileAbsent, text: commit.text }));
}

function listCommitPositions(scene: Scene, fileName: string): number[] {
    return summarizeCommits(scene, fileName).map((commit) => (commit as { position: number }).position);
}

type DockerSpawnCounts = { runCount: () => number; controlCount: () => number };

// Counts the docker child processes the module under test starts; the real functions still run.
function startDockerSpawnSpy(t: TestContext): DockerSpawnCounts {
    let runCount = 0;
    let controlCount = 0;
    const originalSpawn = childProcess.spawn;
    const originalSpawnSync = childProcess.spawnSync;
    const countingSpawn = (...spawnArguments: unknown[]): unknown => {
        if (spawnArguments[0] === "docker") {
            runCount += 1;
        }
        return (originalSpawn as (...argumentList: unknown[]) => unknown)(...spawnArguments);
    };
    const countingSpawnSync = (...spawnArguments: unknown[]): unknown => {
        if (spawnArguments[0] === "docker") {
            controlCount += 1;
        }
        return (originalSpawnSync as (...argumentList: unknown[]) => unknown)(...spawnArguments);
    };
    t.mock.method(childProcess, "spawn", countingSpawn as typeof childProcess.spawn);
    t.mock.method(childProcess, "spawnSync", countingSpawnSync as typeof childProcess.spawnSync);
    syncBuiltinESMExports();
    t.after(() => {
        t.mock.restoreAll();
        syncBuiltinESMExports();
    });
    return { runCount: () => runCount, controlCount: () => controlCount };
}

function captureConsoleMethod(t: TestContext, methodName: "log" | "error"): string[] {
    const lines: string[] = [];
    t.mock.method(console, methodName, (...parts: unknown[]) => {
        lines.push(parts.join(" "));
    });
    return lines;
}

function formatMissingExecutableLine(name: string): string {
    return `script replay: missing executable or Python module ${name} in reveng-sandbox:1: add it to sandbox-image/Dockerfile`;
}

// One file whose text before the script is "v0\n"; the script writes "v1\n"; the disk holds diskText.
function makeOneScriptScene(t: TestContext, diskText: string): Scene {
    return makeScene(t, { "f.txt": diskText }, (projectFolder) => [
        ...makeWriteCreateRows("toolu_write", join(projectFolder, "f.txt"), "v0\n", 10, projectFolder),
        makeBashRecord("toolu_script", `printf 'v1\\n' > ${join(projectFolder, "f.txt")}`, 20, projectFolder),
    ]);
}

function makeTaskRecord(overrides: Partial<ScriptReplayTaskRecord>): ScriptReplayTaskRecord {
    return {
        taskId: "/logs/s1.jsonl:1:toolu_1",
        instant: makeInstant(1).toISOString(),
        jsonlPath: "/logs/s1.jsonl",
        line: 1,
        toolUseId: "toolu_1",
        executorKind: ScriptExecutorKind.bash,
        language: null,
        cwd: "/work/project",
        code: "echo hi > out.txt",
        invokedScriptPath: null,
        runInBackground: false,
        ...overrides,
    };
}

test("test_get_refusal_names_background_internet_language_and_outside_cwd", () => {
    // Scenario: a task that can run has no refusal; each task that must not run gets a reason that names the cause.
    const recordedProjectFolder = new Path("/work/project");
    // A plain foreground shell task inside the project has no refusal.
    assert.equal(getScriptReplayRefusal(makeTaskRecord({}), recordedProjectFolder), undefined);
    // The languages python, python3, shell, bash and sh have no refusal.
    for (const language of ["python", "python3", "shell", "bash", "sh"]) {
        assert.equal(getScriptReplayRefusal(makeTaskRecord({ language }), recordedProjectFolder), undefined);
    }
    // A background task is refused and the reason names the background.
    assert.match(getScriptReplayRefusal(makeTaskRecord({ runInBackground: true }), recordedProjectFolder)!, /background/);
    // A task that uses the internet is refused and the reason names the internet.
    assert.match(getScriptReplayRefusal(makeTaskRecord({ code: "curl https://example.com -o out.txt" }), recordedProjectFolder)!, /internet/);
    // A task in another language is refused and the reason names the language.
    assert.match(getScriptReplayRefusal(makeTaskRecord({ language: "ruby" }), recordedProjectFolder)!, /ruby/);
    // A task whose cwd is outside the project is refused and the reason names the cwd.
    assert.match(getScriptReplayRefusal(makeTaskRecord({ cwd: "/elsewhere" }), recordedProjectFolder)!, /\/elsewhere/);
    // A task whose cwd only shares the text start of the project folder is refused too.
    assert.match(getScriptReplayRefusal(makeTaskRecord({ cwd: "/work/project-other" }), recordedProjectFolder)!, /outside/);
    // A task that calls a .js or a .ts script is refused.
    assert.match(getScriptReplayRefusal(makeTaskRecord({ invokedScriptPath: "tool.js" }), recordedProjectFolder)!, /tool\.js/);
    assert.match(getScriptReplayRefusal(makeTaskRecord({ invokedScriptPath: "tool.ts" }), recordedProjectFolder)!, /tool\.ts/);
});

test("test_choose_interpreter_follows_executor_kind_and_invoked_script_extension", () => {
    // Scenario: bash tasks run in bash and python tasks in python, except that the extension of a called script wins.
    // A bash task runs in bash.
    assert.equal(chooseScriptInterpreter(makeTaskRecord({ executorKind: ScriptExecutorKind.bash })), ScriptInterpreter.Bash);
    // A python task runs in python.
    assert.equal(chooseScriptInterpreter(makeTaskRecord({ executorKind: ScriptExecutorKind.python })), ScriptInterpreter.Python);
    // A bash task that called a .py script runs the python body in python.
    assert.equal(chooseScriptInterpreter(makeTaskRecord({ executorKind: ScriptExecutorKind.bash, invokedScriptPath: "move_files.py" })), ScriptInterpreter.Python);
    // A python task that called a .sh script runs the body in bash.
    assert.equal(chooseScriptInterpreter(makeTaskRecord({ executorKind: ScriptExecutorKind.python, invokedScriptPath: "run.sh" })), ScriptInterpreter.Bash);
});

test("test_list_only_prints_tasks_and_runs_no_container", async (t) => {
    // Scenario: --list-only prints one line per task and starts no docker process.
    // A project has one file with a script gap.
    const scene = makeOneScriptScene(t, "v1\n");
    // Every docker child process is counted, and console.log is captured.
    const spawnCounts = startDockerSpawnSpy(t);
    const printedLines = captureConsoleMethod(t, "log");
    // The command line runs with --list-only.
    await executeScriptReplayCommandLine([
        "--project", scene.projectFolder.toString(), "--jsonls", scene.jsonlsFolder.toString(),
        "--file-history", scene.historyFolder.toString(), "--store", scene.storeFolder.toString(), "--list-only",
    ], TEST_CONTAINER_PREFIX);
    // Exactly one printed line starts with the task instant and ends with the task id and the waiting file.
    const taskLines = printedLines.filter((line) => line.startsWith(makeCallInstant(20).toISOString()));
    assert.equal(taskLines.length, 1);
    assert.match(taskLines[0]!, /s1\.jsonl:\d+:toolu_script f\.txt$/);
    // No docker process of any kind started.
    assert.equal(spawnCounts.runCount(), 0);
    assert.equal(spawnCounts.controlCount(), 0);
});

test("test_script_gap_between_two_beacons_is_filled_and_proven_when_the_result_matches", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: a Write gives "v0", a script writes "v1", and the disk holds "v1".
    const scene = makeOneScriptScene(t, "v1\n");
    buildStore(scene);
    // Before the replay the repo has no commit at position 1.
    assert.deepEqual(listCommitPositions(scene, "f.txt"), [0, 2, 3]);
    // The replay runs.
    const outcomes = await replayScene(scene);
    // One task ran and succeeded, and its file outcome says the gap is filled and proven.
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]!.outcome, ScriptTaskOutcomeKind.Replayed);
    assert.equal(outcomes[0]!.exitCode, 0);
    assert.deepEqual(outcomes[0]!.files, [{ relativePath: "f.txt", changeKind: ScriptReplayChangeKind.Changed, confidence: StateConfidence.Proven, isGapFilled: true }]);
    // The repo has a commit at position 1 with the script result, and it is proven.
    assert.deepEqual(summarizeCommits(scene, "f.txt")[1], { position: 1, confidence: StateConfidence.Proven, isFileAbsent: false, text: "v1\n" });
});

test("test_edit_before_the_script_is_applied_forward_and_the_script_input_includes_it", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: a Write gives "base", an Edit (no originalFile) makes "mid", a script appends "tail"; the disk holds "mid" and "tail".
    const scene = makeScene(t, { "edited.txt": "mid\ntail\n" }, (projectFolder) => {
        const file = join(projectFolder, "edited.txt");
        return [
            ...makeWriteCreateRows("toolu_write", file, "base\n", 10, projectFolder),
            ...makeEditRowsWithoutOriginalFile("toolu_edit", file, "base", "mid", 20, projectFolder),
            makeBashRecord("toolu_script", `printf 'tail\\n' >> ${file}`, 30, projectFolder),
        ];
    });
    buildStore(scene);
    // The Edit and the script are both missing from the repo.
    assert.deepEqual(listCommitPositions(scene, "edited.txt"), [0, 4, 5]);
    // The replay runs.
    await replayScene(scene);
    // The script saw "mid" (the Edit applied forward), so its result is "mid" then "tail", the same as the disk: proven.
    const commits = summarizeCommits(scene, "edited.txt");
    assert.deepEqual(commits[1], { position: 1, confidence: StateConfidence.Proven, isFileAbsent: false, text: "mid\ntail\n" });
    // The Edit states hold the text after and before the Edit.
    assert.deepEqual(commits[2], { position: 2, confidence: StateConfidence.Proven, isFileAbsent: false, text: "mid\n" });
    assert.deepEqual(commits[3], { position: 3, confidence: StateConfidence.Proven, isFileAbsent: false, text: "base\n" });
});

test("test_one_task_for_three_files_runs_once_and_fills_three_repos", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: one script writes three files; each file has a Write before it.
    const fileNames = ["a.txt", "b.txt", "c.txt"];
    const scene = makeScene(t, { "a.txt": "a1\n", "b.txt": "b1\n", "c.txt": "c1\n" }, (projectFolder) => {
        const records: object[] = [];
        for (const [index, fileName] of fileNames.entries()) {
            records.push(...makeWriteCreateRows(`toolu_write_${index}`, join(projectFolder, fileName), "old\n", 10 + index, projectFolder));
        }
        const command = fileNames.map((fileName) => `printf '${fileName[0]}1\\n' > ${join(projectFolder, fileName)}`).join("; ");
        records.push(makeBashRecord("toolu_script", command, 20, projectFolder));
        return records;
    });
    buildStore(scene);
    const spawnCounts = startDockerSpawnSpy(t);
    // The replay runs.
    const outcomes = await replayScene(scene);
    // One container ran, one outcome came back, and it lists the three files, all filled.
    assert.equal(spawnCounts.runCount(), 1);
    assert.equal(outcomes.length, 1);
    assert.deepEqual(outcomes[0]!.files.map((file) => [file.relativePath, file.isGapFilled]), [["a.txt", true], ["b.txt", true], ["c.txt", true]]);
    // Each repo has the script result at position 1.
    for (const fileName of fileNames) {
        assert.equal((summarizeCommits(scene, fileName)[1] as { text: string }).text, `${fileName[0]}1\n`);
    }
});

test("test_failed_script_writes_nothing", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: the script writes "v1" and then exits with code 3.
    const scene = makeScene(t, { "f.txt": "v1\n" }, (projectFolder) => [
        ...makeWriteCreateRows("toolu_write", join(projectFolder, "f.txt"), "v0\n", 10, projectFolder),
        makeBashRecord("toolu_script", `printf 'v1\\n' > ${join(projectFolder, "f.txt")}; exit 3`, 20, projectFolder),
    ]);
    buildStore(scene);
    const commitsBefore = summarizeCommits(scene, "f.txt");
    // The replay runs.
    const outcomes = await replayScene(scene);
    // The task is failed with exit code 3, and the file outcome says the gap is not filled.
    assert.equal(outcomes[0]!.outcome, ScriptTaskOutcomeKind.Failed);
    assert.equal(outcomes[0]!.exitCode, 3);
    assert.equal(outcomes[0]!.files[0]!.isGapFilled, false);
    // The repo is the same as before.
    assert.deepEqual(summarizeCommits(scene, "f.txt"), commitsBefore);
});

test("test_history_end_script_gap_gives_absent_before_commit_and_text_commit", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: a script made the file (the only event), and the disk holds what the script wrote.
    const scene = makeScene(t, { "made.txt": "hello\n" }, (projectFolder) => [
        makeBashRecord("toolu_script", `printf 'hello\\n' > ${join(projectFolder, "made.txt")}`, 10, projectFolder),
    ]);
    buildStore(scene);
    assert.deepEqual(listCommitPositions(scene, "made.txt"), [0]);
    // The replay runs.
    await replayScene(scene);
    // Position 1 holds the text the script wrote, proven; position 2 says the file was absent before, a guess.
    const commits = summarizeCommits(scene, "made.txt");
    assert.deepEqual(commits[1], { position: 1, confidence: StateConfidence.Proven, isFileAbsent: false, text: "hello\n" });
    assert.deepEqual(commits[2], { position: 2, confidence: StateConfidence.Derived, isFileAbsent: true, text: undefined });
});

// born_file.txt has a Write that gives "new" over "seed"; the scripts before it build the file name so no script names it.
function makeBornScene(t: TestContext, makeScripts: (projectFolder: string) => object[]): Scene {
    return makeScene(t, { "born_file.txt": "new\n" }, (projectFolder) => [
        ...makeScripts(projectFolder),
        ...makeWriteUpdateRows("toolu_write", join(projectFolder, "born_file.txt"), "new\n", "seed\n", 20, projectFolder),
    ]);
}

function makeBirthCommand(text: string): string {
    return `stem=born; printf '${text}\\n' | tee \${stem}_file.txt`;
}

test("test_birth_candidate_that_creates_the_file_is_accepted_and_later_candidates_are_skipped", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: two scripts before the oldest event; the first writes "seed", the second writes "other".
    const scene = makeBornScene(t, (projectFolder) => [
        makeBashRecord("toolu_first", makeBirthCommand("seed"), 5, projectFolder),
        makeBashRecord("toolu_second", makeBirthCommand("other"), 8, projectFolder),
    ]);
    buildStore(scene);
    assert.deepEqual(listCommitPositions(scene, "born_file.txt"), [0, 1, 2]);
    // The replay runs.
    const outcomes = await replayScene(scene);
    // The first task is replayed and fills the gap; the second is not run.
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes[0]!.outcome, ScriptTaskOutcomeKind.Replayed);
    assert.equal(outcomes[0]!.files[0]!.isGapFilled, true);
    assert.equal(outcomes[1]!.outcome, ScriptTaskOutcomeKind.Refused);
    assert.equal(outcomes[1]!.files[0]!.isGapFilled, false);
    // The born text is the text of the first script; the state before it is absent, a guess.
    const commits = summarizeCommits(scene, "born_file.txt");
    assert.deepEqual(commits.slice(3), [
        { position: 3, confidence: StateConfidence.Proven, isFileAbsent: false, text: "seed\n" },
        { position: 4, confidence: StateConfidence.Derived, isFileAbsent: true, text: undefined },
    ]);
});

test("test_birth_candidate_that_does_not_create_the_file_writes_nothing", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: the only script before the oldest event writes another file.
    const scene = makeBornScene(t, (projectFolder) => [
        makeBashRecord("toolu_other", `printf 'x\\n' > ${join(projectFolder, "unrelated.txt")}`, 5, projectFolder),
    ]);
    buildStore(scene);
    const commitsBefore = summarizeCommits(scene, "born_file.txt");
    // The replay runs.
    const outcomes = await replayScene(scene);
    // The script ran without error, but it did not make the file, so the gap is not filled.
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]!.outcome, ScriptTaskOutcomeKind.Replayed);
    assert.equal(outcomes[0]!.files[0]!.isGapFilled, false);
    // The repo is the same as before.
    assert.deepEqual(summarizeCommits(scene, "born_file.txt"), commitsBefore);
});

test("test_result_that_differs_from_the_newer_commit_is_written_as_derived", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: the script writes "v1", but the disk holds "other".
    const scene = makeOneScriptScene(t, "other\n");
    buildStore(scene);
    // The replay runs.
    const outcomes = await replayScene(scene);
    // The file outcome and the commit at position 1 say derived, with the script text.
    assert.equal(outcomes[0]!.files[0]!.confidence, StateConfidence.Derived);
    assert.deepEqual(summarizeCommits(scene, "f.txt")[1], { position: 1, confidence: StateConfidence.Derived, isFileAbsent: false, text: "v1\n" });
});

test("test_second_run_finds_no_task", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: a replay fills the only gap; a second replay has nothing to do.
    const scene = makeOneScriptScene(t, "v1\n");
    buildStore(scene);
    await replayScene(scene);
    const spawnCounts = startDockerSpawnSpy(t);
    // The second replay returns no outcome and starts no container.
    const secondOutcomes = await replayScene(scene);
    assert.deepEqual(secondOutcomes, []);
    assert.equal(spawnCounts.runCount(), 0);
});

test("test_clean_removes_the_store_folder_and_containers", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: --clean removes a store folder inside the cache folder and the containers of the prefix.
    // The store folder is inside the cache folder and holds a file.
    const storeFolder = join(INVERSE_REPOS_CACHE_FOLDER, `jfred-test-${randomUUID()}`);
    mkdirSync(storeFolder, { recursive: true });
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    writeFileSync(join(storeFolder, "marker.txt"), "marker");
    // A left-over container with the test prefix exists; docker create runs nothing.
    const containerName = `${TEST_CONTAINER_PREFIX}leftover`;
    const createResult = spawnSync("docker", ["create", "--name", containerName, SANDBOX_IMAGE], { encoding: "utf8" });
    assert.equal(createResult.status, 0, createResult.stderr);
    const listContainers = (): string => spawnSync("docker", ["ps", "-aq", "--filter", `name=^/${containerName}$`], { encoding: "utf8" }).stdout.trim();
    assert.notEqual(listContainers(), "");
    const printedLines = captureConsoleMethod(t, "log");
    // The clean command runs.
    await executeScriptReplayCommandLine(["--clean", "--store", storeFolder], TEST_CONTAINER_PREFIX);
    // The store folder is gone, the container is gone, and the printed count is 1.
    assert.equal(existsSync(storeFolder), false);
    assert.equal(listContainers(), "");
    assert.ok(printedLines.some((line) => /\b1\b/.test(line)));
});

test("test_abort_signal_stops_before_the_next_task", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: two files, each with its own script; the abort comes when the second task starts.
    const scene = makeScene(t, { "f1.txt": "v1\n", "f2.txt": "v1\n" }, (projectFolder) => [
        ...makeWriteCreateRows("toolu_write_1", join(projectFolder, "f1.txt"), "v0\n", 10, projectFolder),
        ...makeWriteCreateRows("toolu_write_2", join(projectFolder, "f2.txt"), "v0\n", 11, projectFolder),
        makeBashRecord("toolu_script_1", `printf 'v1\\n' > ${join(projectFolder, "f1.txt")}`, 20, projectFolder),
        makeBashRecord("toolu_script_2", `printf 'v1\\n' > ${join(projectFolder, "f2.txt")}`, 21, projectFolder),
    ]);
    buildStore(scene);
    const abortController = new AbortController();
    const reportProgress = (event: { label: string }): void => {
        if (event.label === "replaying script 2 of 2") {
            abortController.abort();
        }
    };
    // The replay rejects with an abort error.
    await assert.rejects(replayScriptTasksForProject(makeSettings(scene), TO_INSTANT, reportProgress, abortController.signal), (error: Error) => error.name === "AbortError");
    // The first file is filled, the second is not.
    assert.deepEqual(listCommitPositions(scene, "f1.txt"), [0, 1, 2, 3]);
    assert.deepEqual(listCommitPositions(scene, "f2.txt"), [0, 2, 3]);
});

test("test_clean_refuses_a_store_outside_the_cache_folder", async (t) => {
    // Scenario: --clean throws for a store folder outside the cache folder and removes nothing.
    // A folder outside the cache folder holds a file.
    const outsideFolder = mkdtempSync(join(tmpdir(), "engine-v3-script-replay-clean-"));
    t.after(() => rmSync(outsideFolder, { recursive: true, force: true }));
    writeFileSync(join(outsideFolder, "marker.txt"), "marker");
    // The command rejects for the folder.
    await assert.rejects(executeScriptReplayCommandLine(["--clean", "--store", outsideFolder], TEST_CONTAINER_PREFIX), /cache folder/);
    // The file is still there.
    assert.equal(existsSync(join(outsideFolder, "marker.txt")), true);
    // The cache folder itself and a folder that only shares its text start are refused too.
    await assert.rejects(executeScriptReplayCommandLine(["--clean", "--store", INVERSE_REPOS_CACHE_FOLDER], TEST_CONTAINER_PREFIX), /cache folder/);
    await assert.rejects(executeScriptReplayCommandLine(["--clean", "--store", `${INVERSE_REPOS_CACHE_FOLDER}-other/x`], TEST_CONTAINER_PREFIX), /cache folder/);
});

test("test_missing_executable_is_logged_and_put_in_the_reason", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: the script calls a program that the image does not have.
    const scene = makeScene(t, { "f.txt": "v1\n" }, (projectFolder) => [
        ...makeWriteCreateRows("toolu_write", join(projectFolder, "f.txt"), "v0\n", 10, projectFolder),
        makeBashRecord("toolu_script", `nosuchtool_xyz > ${join(projectFolder, "f.txt")}`, 20, projectFolder),
    ]);
    buildStore(scene);
    const errorLines = captureConsoleMethod(t, "error");
    // The replay runs.
    const outcomes = await replayScene(scene);
    // The exact line was logged one time, and it is the reason of the failed task.
    const expectedLine = formatMissingExecutableLine("nosuchtool_xyz");
    assert.deepEqual(errorLines.filter((line) => line === expectedLine), [expectedLine]);
    assert.equal(outcomes[0]!.outcome, ScriptTaskOutcomeKind.Failed);
    assert.equal(outcomes[0]!.reason, expectedLine);
    assert.equal(outcomes[0]!.missingExecutable, "nosuchtool_xyz");
});

test("test_cli_prints_each_missing_executable_once", { timeout: DOCKER_TEST_TIMEOUT_MS }, async (t) => {
    // Scenario: three scripts call missing programs a, b, a (in time order).
    const toolNames = ["nosuchtool_a", "nosuchtool_b", "nosuchtool_a"];
    const fileNames = ["f1.txt", "f2.txt", "f3.txt"];
    const scene = makeScene(t, { "f1.txt": "v1\n", "f2.txt": "v1\n", "f3.txt": "v1\n" }, (projectFolder) => {
        const records: object[] = [];
        for (const [index, fileName] of fileNames.entries()) {
            records.push(...makeWriteCreateRows(`toolu_write_${index}`, join(projectFolder, fileName), "v0\n", 10 + index, projectFolder));
            records.push(makeBashRecord(`toolu_script_${index}`, `${toolNames[index]} > ${join(projectFolder, fileName)}`, 20 + index, projectFolder));
        }
        return records;
    });
    captureConsoleMethod(t, "error");
    const printedLines = captureConsoleMethod(t, "log");
    // The command line runs the replay.
    await executeScriptReplayCommandLine([
        "--project", scene.projectFolder.toString(), "--jsonls", scene.jsonlsFolder.toString(),
        "--file-history", scene.historyFolder.toString(), "--store", scene.storeFolder.toString(),
    ], TEST_CONTAINER_PREFIX);
    // The missing-program line of each name is printed one time, in first-seen order.
    const missingLines = printedLines.filter((line) => line.startsWith("script replay: missing executable"));
    assert.deepEqual(missingLines, [formatMissingExecutableLine("nosuchtool_a"), formatMissingExecutableLine("nosuchtool_b")]);
});

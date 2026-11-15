import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path, Uuid } from "../src/structures/domain.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { StateConfidence, StateMoment, type FileKnownState } from "./engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { createInverseRepo, insertStatesIntoInverseRepo } from "./engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile, type ProjectFile } from "./engineV3_inverse_repos_for_project.ts";
import {
    ReplayGapKind, convertScriptRunToTaskRecord, convertTaskRecordToScriptRun, writeReplayGapsSidecar,
    type BornlessRecord, type ReplayGapRecord, type ReplayGapsSidecar, type ScriptReplayTaskRecord,
} from "./engineV3_script_replay_gaps.ts";
import {
    MAX_BIRTH_CANDIDATES_PER_FILE, ScriptReplayTaskReason, buildBornGap, listBirthCandidateRecords, listScriptReplayTasks,
} from "./engineV3_script_replay_tasks.ts";

const JSONL_PATH = "/logs/session.jsonl";
const WRITE_CAPABLE_COMMAND = "echo hello > out.txt";
const READ_ONLY_COMMAND = "ls";

type Fixture = { storeFolder: Path; projectFolder: Path; scratchFolder: Path };

function makeFixture(t: TestContext): Fixture {
    const rootFolder = mkdtempSync(join(tmpdir(), "engine-v3-script-replay-tasks-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const storeFolder = join(rootFolder, "store");
    const projectFolder = join(rootFolder, "project");
    const scratchFolder = join(rootFolder, "scratch");
    mkdirSync(storeFolder);
    mkdirSync(projectFolder);
    mkdirSync(scratchFolder);
    return { storeFolder: new Path(storeFolder), projectFolder: new Path(projectFolder), scratchFolder: new Path(scratchFolder) };
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEvent(type: FileEventType, second: number | undefined, line: number | undefined): FileEvent {
    let instant: Date | undefined;
    if (second !== undefined) {
        instant = makeInstant(second);
    }
    let source: FileEvent["source"];
    if (line !== undefined) {
        source = { filePath: JSONL_PATH, lineNumber: line };
    }
    return { type, instant, source, commitHash: undefined, bytes: undefined, row: undefined, moveOrCopySourceFile: undefined, removedByScript: false, movedAwayToFile: undefined, scriptRun: undefined };
}

function makeState(event: FileEvent, text: string): FileKnownState {
    return { event, moment: StateMoment.AtEvent, confidence: StateConfidence.Proven, isFileAbsent: false, text };
}

function makeScriptRun(second: number, line: number): ScriptRun {
    return {
        code: `echo ${line} > out.txt`,
        timestamp: makeInstant(second),
        cwd: new Path("/project"),
        source: { filePath: JSONL_PATH, lineNumber: line },
        toolUseId: new Uuid(`toolu_${line}`),
        executorKind: ScriptExecutorKind.bash,
        runInBackground: false,
    };
}

function makeTaskRecord(second: number, line: number): ScriptReplayTaskRecord {
    return convertScriptRunToTaskRecord(makeScriptRun(second, line));
}

function makeProjectFile(fixture: Fixture, fileName: string): ProjectFile {
    const file = new Path(join(fixture.projectFolder.toString(), fileName));
    return { file, transcriptFile: file };
}

function makeBornlessRecord(nextFreePosition: number, oldestSecond: number): BornlessRecord {
    return { nextFreePosition, oldestInstant: makeInstant(oldestSecond).toISOString(), oldestJsonlPath: JSONL_PATH };
}

// Builds the repo of one file with a disk-now commit and git commits at the given positions, and writes its sidecar.
function makeRepoWithSidecar(fixture: Fixture, projectFile: ProjectFile, fileName: string, storedGitPositions: number[], sidecar: ReplayGapsSidecar): void {
    const repoFolder = getInverseRepoFolderForFile(fixture.storeFolder, fixture.projectFolder, projectFile.file);
    const diskNowState = makeState(makeEvent(FileEventType.DiskNow, undefined, undefined), "now");
    createInverseRepo(repoFolder, fileName, { state: diskNowState, position: 0 }, makeInstant(1000));
    const olderStates = storedGitPositions.map((position) => ({ state: makeState(makeEvent(FileEventType.GitCommit, 100 - position, position), `text ${position}`), position }));
    insertStatesIntoInverseRepo(repoFolder, fileName, olderStates);
    writeReplayGapsSidecar(repoFolder, sidecar);
}

function makeGapSidecar(gapRecords: ReplayGapRecord[]): ReplayGapsSidecar {
    return { gaps: gapRecords, bornless: null };
}

type TranscriptRun = { second: number; command: string; cwd: string };

function writeTranscript(fixture: Fixture, runs: TranscriptRun[], fileName = "session.jsonl"): Path {
    const lines = runs.map((run, index) => {
        const toolUse = { type: "tool_use", id: `toolu_run_${index}`, name: "Bash", input: { command: run.command }, caller: { type: "direct" } };
        const record = { type: "assistant", uuid: `uuid_run_${index}`, timestamp: makeInstant(run.second).toISOString(), cwd: run.cwd, message: { role: "assistant", content: [toolUse] } };
        return JSON.stringify(record);
    });
    const transcriptPath = join(fixture.scratchFolder.toString(), fileName);
    writeFileSync(transcriptPath, lines.join("\n") + "\n");
    return new Path(transcriptPath);
}

function listLines(records: ScriptReplayTaskRecord[]): number[] {
    return records.map((record) => record.line);
}

test("test_unfilled_gap_task_is_listed_with_its_waiting_file", (t) => {
    // Scenario: a gap with a script task and a missing commit gives one task that names the file.
    // Steps:
    // The repo of a.txt holds positions 0 and 3. The sidecar has one gap with dropped positions 1 and 2 and one task.
    const fixture = makeFixture(t);
    const projectFile = makeProjectFile(fixture, "a.txt");
    const taskRecord = makeTaskRecord(50, 7);
    makeRepoWithSidecar(fixture, projectFile, "a.txt", [3], makeGapSidecar([{ newerPosition: 0, olderPosition: 3, droppedPositions: [1, 2], scriptTasks: [taskRecord] }]));
    // The function lists the tasks up to a late instant.
    const tasks = listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, [projectFile], fixture.projectFolder, makeInstant(500), [fixture.scratchFolder]);
    // It returns one task with the record, its instant, and one waiting file named by the file.
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0]!.record, taskRecord);
    assert.equal(tasks[0]!.instant.getTime(), makeInstant(50).getTime());
    assert.deepEqual(tasks[0]!.waitingFiles, [{ relativePath: "a.txt", reason: ScriptReplayTaskReason.NamedByFile }]);
});

test("test_filled_gap_task_is_not_listed", (t) => {
    // Scenario: when every dropped position has a commit, the gap needs no task.
    // Steps:
    // The repo of a.txt holds positions 0, 1, 2 and 3. The sidecar has one gap with dropped positions 1 and 2.
    const fixture = makeFixture(t);
    const projectFile = makeProjectFile(fixture, "a.txt");
    makeRepoWithSidecar(fixture, projectFile, "a.txt", [1, 2, 3], makeGapSidecar([{ newerPosition: 0, olderPosition: 3, droppedPositions: [1, 2], scriptTasks: [makeTaskRecord(50, 7)] }]));
    // The function lists the tasks.
    const tasks = listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, [projectFile], fixture.projectFolder, makeInstant(500), [fixture.scratchFolder]);
    // It returns no task.
    assert.deepEqual(tasks, []);
});

test("test_one_task_for_three_files_lists_three_waiting_files", (t) => {
    // Scenario: one script makes three files, so the three files wait on one task.
    // Steps:
    // Three files each have an unfilled gap that holds the same task record.
    const fixture = makeFixture(t);
    const taskRecord = makeTaskRecord(50, 7);
    const fileNames = ["a.txt", "b.txt", "c.txt"];
    const projectFiles = fileNames.map((fileName) => makeProjectFile(fixture, fileName));
    for (const [index, fileName] of fileNames.entries()) {
        makeRepoWithSidecar(fixture, projectFiles[index]!, fileName, [3], makeGapSidecar([{ newerPosition: 0, olderPosition: 3, droppedPositions: [1, 2], scriptTasks: [taskRecord] }]));
    }
    // The function lists the tasks.
    const tasks = listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, projectFiles, fixture.projectFolder, makeInstant(500), [fixture.scratchFolder]);
    // It returns one task with three waiting files, one per file.
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0]!.waitingFiles.map((waitingFile) => waitingFile.relativePath), fileNames);
});

test("test_task_after_to_instant_is_not_listed", (t) => {
    // Scenario: only tasks at or before the end of the span are needed.
    // Steps:
    // One gap holds three tasks: one before, one at, and one after the end instant.
    const fixture = makeFixture(t);
    const projectFile = makeProjectFile(fixture, "a.txt");
    const scriptTasks = [makeTaskRecord(10, 1), makeTaskRecord(20, 2), makeTaskRecord(30, 3)];
    makeRepoWithSidecar(fixture, projectFile, "a.txt", [3], makeGapSidecar([{ newerPosition: 0, olderPosition: 3, droppedPositions: [1, 2], scriptTasks }]));
    // The function lists the tasks up to the instant of the second task.
    const tasks = listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, [projectFile], fixture.projectFolder, makeInstant(20), [fixture.scratchFolder]);
    // It returns the first two tasks in time order and not the third.
    assert.deepEqual(listLines(tasks.map((task) => task.record)), [1, 2]);
});

test("test_birth_candidates_are_the_last_five_write_capable_runs_before_the_oldest_event", (t) => {
    // Scenario: only the last five write-capable runs before the oldest event are candidates.
    // Steps:
    // The transcript has seven write-capable runs, one read-only run, and one write-capable run after the oldest event.
    const fixture = makeFixture(t);
    const projectCwd = fixture.projectFolder.toString();
    const runs: TranscriptRun[] = [];
    for (let second = 1; second <= 7; second++) {
        runs.push({ second, command: WRITE_CAPABLE_COMMAND, cwd: projectCwd });
    }
    runs.push({ second: 8, command: READ_ONLY_COMMAND, cwd: projectCwd });
    runs.push({ second: 20, command: WRITE_CAPABLE_COMMAND, cwd: projectCwd });
    const transcriptPath = writeTranscript(fixture, runs);
    // The function lists the candidates for an oldest event at second 10.
    const candidates = listBirthCandidateRecords([transcriptPath], makeInstant(10), fixture.projectFolder);
    // It returns the runs of seconds 3 to 7, which are lines 3 to 7, in time order.
    assert.equal(MAX_BIRTH_CANDIDATES_PER_FILE, 5);
    assert.deepEqual(listLines(candidates), [3, 4, 5, 6, 7]);
});

test("test_birth_candidate_outside_project_cwd_is_dropped", (t) => {
    // Scenario: a run whose cwd is outside the project folder cannot have made a project file.
    // Steps:
    // The transcript has a write-capable run inside the project and one outside it.
    const fixture = makeFixture(t);
    const transcriptPath = writeTranscript(fixture, [
        { second: 1, command: WRITE_CAPABLE_COMMAND, cwd: join(fixture.projectFolder.toString(), "sub") },
        { second: 2, command: WRITE_CAPABLE_COMMAND, cwd: fixture.scratchFolder.toString() },
    ]);
    // The function lists the candidates.
    const candidates = listBirthCandidateRecords([transcriptPath], makeInstant(10), fixture.projectFolder);
    // It returns only the run inside the project.
    assert.deepEqual(listLines(candidates), [1]);
});

test("test_born_gap_has_two_dropped_states_after_the_oldest_position", () => {
    // Scenario: a born gap asks whether a script run made the file, so it holds an "at" state and a "before" state.
    // Steps:
    // A bornless record says position 3 is the next free position.
    const bornless = makeBornlessRecord(3, 10);
    const record = makeTaskRecord(5, 9);
    // The function builds the born gap for one task record.
    const gap = buildBornGap(bornless, record);
    // The gap sits under position 2 and has no older position.
    assert.equal(gap.kind, ReplayGapKind.Born);
    assert.equal(gap.newerPosition, 2);
    assert.equal(gap.olderPosition, undefined);
    // The two dropped states are at positions 3 and 4, an "at" moment and a "before" moment, both unknown and not absent.
    assert.deepEqual(gap.droppedStates.map((orderedState) => orderedState.position), [3, 4]);
    assert.deepEqual(gap.droppedStates.map((orderedState) => orderedState.state.moment), [StateMoment.AtEvent, StateMoment.BeforeEvent]);
    for (const orderedState of gap.droppedStates) {
        assert.equal(orderedState.state.confidence, StateConfidence.Unknown);
        assert.equal(orderedState.state.isFileAbsent, false);
        assert.equal(orderedState.state.text, undefined);
    }
    // Both states share one script event made from the record.
    const sharedEvent = gap.droppedStates[0]!.state.event;
    assert.equal(gap.droppedStates[1]!.state.event, sharedEvent);
    const expectedEvent: FileEvent = {
        type: FileEventType.ScriptMayWrite,
        instant: new Date(record.instant),
        source: { filePath: record.jsonlPath, lineNumber: record.line },
        commitHash: undefined,
        bytes: undefined,
        row: undefined,
        moveOrCopySourceFile: undefined,
        removedByScript: false,
        movedAwayToFile: undefined,
        scriptRun: convertTaskRecordToScriptRun(record),
    };
    assert.deepEqual(sharedEvent, expectedEvent);
});

test("test_missing_sidecar_throws_with_the_build_hint", (t) => {
    // Scenario: a repo without a gaps file means the repos were not built by the current builder.
    // Steps:
    // The repo of a.txt exists but its sidecar was never written.
    const fixture = makeFixture(t);
    const projectFile = makeProjectFile(fixture, "a.txt");
    const repoFolder = getInverseRepoFolderForFile(fixture.storeFolder, fixture.projectFolder, projectFile.file);
    const diskNowState = makeState(makeEvent(FileEventType.DiskNow, undefined, undefined), "now");
    createInverseRepo(repoFolder, "a.txt", { state: diskNowState, position: 0 }, makeInstant(1000));
    // The function lists the tasks. It throws, and the message says to build the repos first.
    assert.throws(
        () => listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, [projectFile], fixture.projectFolder, makeInstant(500), [fixture.scratchFolder]),
        /build the inverse repos first/,
    );
});

test("test_bornless_file_lists_its_birth_candidates_as_tasks", (t) => {
    // Scenario: a file with no "absent" state and no history-end gap waits on the runs that may have made it.
    // Steps:
    // The transcript has two write-capable runs before second 10.
    const fixture = makeFixture(t);
    const projectCwd = fixture.projectFolder.toString();
    const transcriptPath = writeTranscript(fixture, [
        { second: 1, command: WRITE_CAPABLE_COMMAND, cwd: projectCwd },
        { second: 2, command: WRITE_CAPABLE_COMMAND, cwd: projectCwd },
    ]);
    // The repo of a.txt holds only position 0. Its sidecar is bornless at position 1 and names the transcript as the oldest log.
    const projectFile = makeProjectFile(fixture, "a.txt");
    const bornless: BornlessRecord = { nextFreePosition: 1, oldestInstant: makeInstant(10).toISOString(), oldestJsonlPath: transcriptPath.toString() };
    makeRepoWithSidecar(fixture, projectFile, "a.txt", [], { gaps: [], bornless });
    // The function lists the tasks.
    const tasks = listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, [projectFile], fixture.projectFolder, makeInstant(500), [fixture.scratchFolder]);
    // It returns two tasks in time order, each waiting file marked as a birth candidate.
    assert.deepEqual(listLines(tasks.map((task) => task.record)), [1, 2]);
    for (const task of tasks) {
        assert.deepEqual(task.waitingFiles, [{ relativePath: "a.txt", reason: ScriptReplayTaskReason.BirthCandidate }]);
    }
});

test("test_birth_candidate_is_found_in_an_earlier_transcript_of_the_project", (t) => {
    // Scenario: the script that made a file ran in an earlier transcript than the one that holds the file's oldest event.
    // Steps:
    // The earlier transcript has one write-capable run at second 1.
    const fixture = makeFixture(t);
    const projectCwd = fixture.projectFolder.toString();
    const earlierTranscriptPath = writeTranscript(fixture, [{ second: 1, command: WRITE_CAPABLE_COMMAND, cwd: projectCwd }], "earlier.jsonl");
    // The later transcript has one read-only run at second 10, which is the oldest event of a.txt.
    const laterTranscriptPath = writeTranscript(fixture, [{ second: 10, command: "cat a.txt", cwd: projectCwd }], "later.jsonl");
    // The repo of a.txt is bornless and names the later transcript as the oldest log.
    const projectFile = makeProjectFile(fixture, "a.txt");
    const bornless: BornlessRecord = { nextFreePosition: 1, oldestInstant: makeInstant(10).toISOString(), oldestJsonlPath: laterTranscriptPath.toString() };
    makeRepoWithSidecar(fixture, projectFile, "a.txt", [], { gaps: [], bornless });
    // The function lists the tasks with the folder that holds both transcripts.
    const tasks = listScriptReplayTasks(fixture.storeFolder, fixture.projectFolder, [projectFile], fixture.projectFolder, makeInstant(500), [fixture.scratchFolder]);
    // It returns the run of the earlier transcript as a birth candidate that a.txt waits on.
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]!.record.jsonlPath, earlierTranscriptPath.toString());
    assert.deepEqual(tasks[0]!.waitingFiles, [{ relativePath: "a.txt", reason: ScriptReplayTaskReason.BirthCandidate }]);
});

// The --auto walk of the terminal UI: jump to the oldest event and wait until every file is done.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, InverseStepOutcome, PlayOutcomeKind, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { StepResultLine } from "../engineV3/engineV3_step_start_at.ts";
import { getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { WALK_COVERAGE_FILE_NAME, readWalkCoverage } from "../engineV3/engineV3_walk_coverage.ts";
import { runAutoWalk } from "../engineV3/tui/engineV3_tui_auto.ts";
import { decideScriptAction, type ConsentAnswers } from "../engineV3/tui/engineV3_tui_consent.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import { createSpawnStepProcess } from "../engineV3/tui/engineV3_tui_step_process.ts";
import { createWalkState, getFileRunState, setFileRunState, type FileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { HistoryWalker, PlayOutcome, PlayRequest, SpawnSettings, StepPool, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { makeEditRows, makeInstant, writeProjectFiles } from "./engineV3_step_test_projects.ts";

const JFRED_FOLDER = new Path(join(import.meta.dirname, ".."));
const REAL_PROCESS_TIMEOUT_MILLISECONDS = 110000;
const OLDEST_INSTANT = makeInstant(10);

function throwBecauseNotExpected(): never {
    throw new Error("runAutoWalk called a function that this test does not expect");
}

function makeRunState(status: FileWalkStatus): FileRunState {
    return { status, reasonText: undefined, failedReplayCount: 0 };
}

// A pool that only answers waitUntilIdle.
function createFakePool(): StepPool {
    return {
        requestWalk: throwBecauseNotExpected,
        requestPlay: throwBecauseNotExpected,
        cancelFile: throwBecauseNotExpected,
        cancelAll: throwBecauseNotExpected,
        stopStarting: throwBecauseNotExpected,
        waitUntilIdle: async () => {},
        listRunningFiles: throwBecauseNotExpected,
    };
}

// A walker whose request of a file moves that file to the status in newStatusByPathString.
function createFakeWalker(
    runStateByPathString: Map<string, FileRunState>,
    newStatusByPathString: Map<string, FileWalkStatus>,
    requestedInstants: { file: Path; instant: Date; isVisible: boolean }[],
    finishedPathStrings?: Set<string>,
): HistoryWalker {
    return {
        walkHistoryTo: (currentTime, file, isVisible) => {
            requestedInstants.push({ file, instant: currentTime, isVisible });
            const newStatus = newStatusByPathString.get(file.toString())!;
            runStateByPathString.set(file.toString(), makeRunState(newStatus));
            if (newStatus === FileWalkStatus.Idle) {
                finishedPathStrings?.add(file.toString());
            }
            return false;
        },
        handleOutcome: throwBecauseNotExpected,
        playScript: throwBecauseNotExpected,
    };
}

test("test_auto_ends_with_every_file_finished_on_a_small_project", { timeout: REAL_PROCESS_TIMEOUT_MILLISECONDS }, async (t) => {
    // Scenario: a made-up project with a.txt edited at seconds 10 and 40 and b.txt edited at second 20.
    // The auto walk targets an instant older than every event, so every file walks past its birth.
    const project = writeProjectFiles(t, new Map([["a.txt", "a2\n"], ["b.txt", "b1\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a1", filePathByFileName.get("a.txt")!, "a0", "a1", null, 10),
        ...makeEditRows(projectFolder, "toolu_b1", filePathByFileName.get("b.txt")!, "b0", "b1", null, 20),
        ...makeEditRows(projectFolder, "toolu_a2", filePathByFileName.get("a.txt")!, "a1", "a2", null, 40),
    ]);
    const files = [project.fileByName.get("a.txt")!, project.fileByName.get("b.txt")!];
    const settings: SpawnSettings = {
        projectFolder: project.projectFolder,
        jsonlsFolders: [project.jsonlsFolder],
        fileHistoryFolders: [project.snapshotFolder],
        storeFolder: project.storeFolder,
        earliestBoundary: undefined,
        jfredFolder: JFRED_FOLDER,
    };
    const isFileWalkFinished = (file: Path): boolean => {
        const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, file);
        return readWalkCoverage(repoFolder)?.isFinished === true;
    };
    // The real walker, the real pool and the real child processes, wired as the terminal UI wires them.
    const walkState = createWalkState();
    let pool: StepPool | undefined;
    const walker = createHistoryWalker({
        storeFolder: project.storeFolder,
        projectFolder: project.projectFolder,
        walkState,
        requestWalk: (request, isVisible) => pool!.requestWalk(request, isVisible),
        requestPlay: throwBecauseNotExpected,
        decideScriptAction: throwBecauseNotExpected,
        playKeyName: "p",
        onStatusChange: () => {},
    });
    pool = createStepPool({
        maxProcesses: 2,
        spawnStepProcess: createSpawnStepProcess(settings),
        spawnPlayProcess: throwBecauseNotExpected,
        onOutcome: (request: StepRequest, outcome: StepProcessOutcome) => {
            void walker.handleOutcome(request, outcome);
        },
        onStatusChange: () => {},
        isFileWalkFinished,
        isFileSteppable: () => true,
        hasLogsGrown: () => false,
        onLogsGrew: throwBecauseNotExpected,
        endChildOfFile: throwBecauseNotExpected,
        endAllChildren: throwBecauseNotExpected,
    });
    // Run the auto walk to the oldest event.
    await runAutoWalk({ oldestInstant: makeInstant(0), files, walker, pool, getRunState: (file) => getFileRunState(walkState, file), isFileWalkFinished, consentGate: Promise.resolve() });
    // Both files have a sidecar that says finished.
    for (const file of files) {
        assert.equal(isFileWalkFinished(file), true, `${file.toString()} is not finished`);
    }
});

test("test_auto_leaves_a_stopped_file_stopped_and_still_ends", async () => {
    // Scenario: the one file stops at a script on its first walk request.
    const file = new Path("/made-up/project/a.txt");
    const runStateByPathString = new Map<string, FileRunState>();
    const requestedInstants: { file: Path; instant: Date; isVisible: boolean }[] = [];
    const walker = createFakeWalker(runStateByPathString, new Map([[file.toString(), FileWalkStatus.Stopped]]), requestedInstants);
    // Run the auto walk; it returns although the file never finishes.
    await runAutoWalk({
        oldestInstant: OLDEST_INSTANT,
        files: [file],
        walker,
        pool: createFakePool(),
        getRunState: (askedFile) => runStateByPathString.get(askedFile.toString()) ?? makeRunState(FileWalkStatus.Idle),
        isFileWalkFinished: () => false,
        consentGate: Promise.resolve(),
    });
    // The file was requested one time, at the oldest instant, and is still Stopped.
    assert.equal(requestedInstants.length, 1);
    assert.equal(requestedInstants[0]!.instant.getTime(), OLDEST_INSTANT.getTime());
    assert.equal(runStateByPathString.get(file.toString())!.status, FileWalkStatus.Stopped);
});

test("test_auto_does_not_wait_for_a_crashed_file", async () => {
    // Scenario: a.txt crashes on its first walk request; b.txt finishes on its first walk request.
    const crashedFile = new Path("/made-up/project/a.txt");
    const finishedFile = new Path("/made-up/project/b.txt");
    const runStateByPathString = new Map<string, FileRunState>();
    const requestedInstants: { file: Path; instant: Date; isVisible: boolean }[] = [];
    const newStatusByPathString = new Map([[crashedFile.toString(), FileWalkStatus.Crashed], [finishedFile.toString(), FileWalkStatus.Idle]]);
    const finishedPathStrings = new Set<string>();
    const walker = createFakeWalker(runStateByPathString, newStatusByPathString, requestedInstants, finishedPathStrings);
    // Run the auto walk; b.txt counts as finished only after its walk request.
    await runAutoWalk({
        oldestInstant: OLDEST_INSTANT,
        files: [crashedFile, finishedFile],
        walker,
        pool: createFakePool(),
        getRunState: (askedFile) => runStateByPathString.get(askedFile.toString()) ?? makeRunState(FileWalkStatus.Idle),
        isFileWalkFinished: (askedFile) => finishedPathStrings.has(askedFile.toString()),
        consentGate: Promise.resolve(),
    });
    // Each file was requested one time, and the crashed file is still Crashed.
    assert.equal(requestedInstants.length, 2);
    assert.equal(runStateByPathString.get(crashedFile.toString())!.status, FileWalkStatus.Crashed);
});

test("test_auto_requests_no_walk_while_the_consent_gate_is_closed_and_walks_after_it_opens", async () => {
    // Scenario: the one file stops on its first walk request; the consent gate starts closed.
    const file = new Path("/made-up/project/a.txt");
    const runStateByPathString = new Map<string, FileRunState>();
    const requestedInstants: { file: Path; instant: Date; isVisible: boolean }[] = [];
    const walker = createFakeWalker(runStateByPathString, new Map([[file.toString(), FileWalkStatus.Stopped]]), requestedInstants);
    let openGate: () => void = throwBecauseNotExpected;
    const consentGate = new Promise<void>((resolve) => { openGate = resolve; });
    // Start the auto walk without awaiting it.
    const autoWalk = runAutoWalk({
        oldestInstant: OLDEST_INSTANT,
        files: [file],
        walker,
        pool: createFakePool(),
        getRunState: (askedFile) => runStateByPathString.get(askedFile.toString()) ?? makeRunState(FileWalkStatus.Idle),
        isFileWalkFinished: () => false,
        consentGate,
    });
    // Wait 30 milliseconds; no walk was requested while the gate is closed.
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    assert.equal(requestedInstants.length, 0);
    // Open the gate; the auto walk runs and returns.
    openGate();
    await autoWalk;
    // The file was requested at least one time.
    assert.ok(requestedInstants.length >= 1);
});

// The S25 shape: f1 f2 f3 stop at one script; f3 also has a stop after the script that only a pass-stops walk passes; f4 has no stop.
const SCRIPT_STOP_SOURCE = "toolu_script";
const SPAWN_DELAY_MILLISECONDS = 5;
const SETTLE_DELAY_MILLISECONDS = 40;
const SETTLE_UNCHANGED_ROUNDS_NEEDED = 3;
const SETTLE_ROUND_LIMIT = 60;
const STEP_SPAWN_LOOP_GUARD = 40;
const STATEFUL_ENGINE_TIMEOUT_MILLISECONDS = 30000;
const MAXIMUM_PROCESSES = 4;

type StepSpawnRecord = { file: Path; isPassingStops: boolean };
type StatefulEngineHarness = {
    files: Path[];
    storeFolder: Path;
    projectFolder: Path;
    walker: HistoryWalker;
    pool: StepPool;
    stepSpawns: StepSpawnRecord[];
    playSpawns: Path[];
    getRunState: (file: Path) => FileRunState;
    isFileWalkFinished: (file: Path) => boolean;
};

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function writeFinishedSidecar(storeFolder: Path, projectFolder: Path, file: Path): void {
    const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
    mkdirSync(repoFolder.toString(), { recursive: true });
    writeFileSync(join(repoFolder.toString(), WALK_COVERAGE_FILE_NAME), JSON.stringify({ tipInstant: null, isFinished: true }));
}

function makeStepResultLine(eventType: FileEventType | null, source: string | null): StepResultLine {
    return { startAt: new Date(0).toISOString(), outcome: InverseStepOutcome.UnknownOrRoadblock, commitsWritten: 0, position: 0, commit: "abc", eventType, source };
}

function makeStoppedOutcome(eventType: FileEventType, source: string | null): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Stopped, eventType, source, lastLine: makeStepResultLine(eventType, source) };
}

function makeFinishedOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Finished, lastLine: makeStepResultLine(null, null) };
}

function makeLoopGuardCrashedOutcome(): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Crashed, exitCode: 1, signal: null, crashedAt: null, stderrTail: "test loop guard" };
}

// The real walker, the real pool and the real auto walk, over a fake engine that keeps the stops of each file in memory and the coverage sidecars on disk.
function buildStatefulEngineHarness(t: TestContext, answers: ConsentAnswers): StatefulEngineHarness {
    const rootFolder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-tui-auto-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const storeFolder = new Path(join(rootFolder, "store"));
    const projectFolder = new Path(join(rootFolder, "project"));
    const files = ["f1.py", "f2.py", "f3.py", "f4.py"].map((fileName) => new Path(join(projectFolder.toString(), fileName)));
    const unresolvedScriptStopFileValues = new Set<string>([files[0]!.value, files[1]!.value, files[2]!.value]);
    const unresolvedUserEditStopFileValues = new Set<string>([files[2]!.value]);
    const stepSpawns: StepSpawnRecord[] = [];
    const playSpawns: Path[] = [];
    const walkState = createWalkState();
    const isFileWalkFinished = (file: Path): boolean => {
        const repoFolder = getInverseRepoFolderForFile(storeFolder, projectFolder, file);
        return readWalkCoverage(repoFolder)?.isFinished === true;
    };
    const decideStepOutcome = (request: StepRequest): StepProcessOutcome => {
        if (stepSpawns.length > STEP_SPAWN_LOOP_GUARD) {
            return makeLoopGuardCrashedOutcome();
        }
        const fileValue = request.file.value;
        if (request.isPassingStops) {
            unresolvedScriptStopFileValues.delete(fileValue);
            unresolvedUserEditStopFileValues.delete(fileValue);
            writeFinishedSidecar(storeFolder, projectFolder, request.file);
            return makeFinishedOutcome();
        }
        if (unresolvedScriptStopFileValues.has(fileValue)) {
            return makeStoppedOutcome(FileEventType.ScriptMayWrite, SCRIPT_STOP_SOURCE);
        }
        if (unresolvedUserEditStopFileValues.has(fileValue)) {
            return makeStoppedOutcome(FileEventType.UserEditNotice, SCRIPT_STOP_SOURCE);
        }
        writeFinishedSidecar(storeFolder, projectFolder, request.file);
        return makeFinishedOutcome();
    };
    const spawnStepProcess = async (request: StepRequest): Promise<StepProcessOutcome> => {
        stepSpawns.push({ file: request.file, isPassingStops: request.isPassingStops });
        const outcome = decideStepOutcome(request);
        await waitMilliseconds(SPAWN_DELAY_MILLISECONDS);
        return outcome;
    };
    const spawnPlayProcess = async (request: PlayRequest): Promise<PlayOutcome> => {
        playSpawns.push(request.file);
        unresolvedScriptStopFileValues.delete(request.file.value);
        await waitMilliseconds(SPAWN_DELAY_MILLISECONDS);
        return { kind: PlayOutcomeKind.Replayed, reasonText: undefined };
    };
    const walker = createHistoryWalker({
        storeFolder,
        projectFolder,
        walkState,
        requestWalk: (request, isVisible) => pool.requestWalk(request, isVisible),
        requestPlay: (request) => pool.requestPlay(request, files.filter((file) => !file.equals(request.file))),
        decideScriptAction: (file, eventType, source) => decideScriptAction(answers, { file, eventType, source }),
        playKeyName: "p",
        onStatusChange: () => {},
    });
    const pool = createStepPool({
        maxProcesses: MAXIMUM_PROCESSES,
        spawnStepProcess,
        spawnPlayProcess,
        onOutcome: (request, outcome) => {
            void walker.handleOutcome(request, outcome);
        },
        onStatusChange: (file, runState) => setFileRunState(walkState, file, runState),
        isFileWalkFinished,
        isFileSteppable: () => true,
        hasLogsGrown: () => false,
        onLogsGrew: throwBecauseNotExpected,
        endChildOfFile: throwBecauseNotExpected,
        endAllChildren: throwBecauseNotExpected,
    });
    return { files, storeFolder, projectFolder, walker, pool, stepSpawns, playSpawns, getRunState: (file) => getFileRunState(walkState, file), isFileWalkFinished };
}

function runAutoWalkOfHarness(harness: StatefulEngineHarness): Promise<void> {
    return runAutoWalk({
        oldestInstant: new Date(0),
        files: harness.files,
        walker: harness.walker,
        pool: harness.pool,
        getRunState: harness.getRunState,
        isFileWalkFinished: harness.isFileWalkFinished,
        consentGate: Promise.resolve(),
    });
}

// Loops until the step spawn count, the play spawn count and the running children stay the same for several rounds.
async function waitUntilEverythingSettles(harness: StatefulEngineHarness): Promise<void> {
    let lastSignature = "";
    let unchangedRounds = 0;
    for (let round = 0; round < SETTLE_ROUND_LIMIT; round++) {
        await harness.pool.waitUntilIdle();
        await waitMilliseconds(SETTLE_DELAY_MILLISECONDS);
        const signature = `${harness.stepSpawns.length} ${harness.playSpawns.length} ${harness.pool.listRunningFiles().length}`;
        if (signature === lastSignature) {
            unchangedRounds += 1;
        } else {
            unchangedRounds = 0;
            lastSignature = signature;
        }
        if (unchangedRounds >= SETTLE_UNCHANGED_ROUNDS_NEEDED) {
            return;
        }
    }
}

function readReasonTextOfFile(harness: StatefulEngineHarness, file: Path): string {
    const reasonText = harness.getRunState(file).reasonText;
    assert.notEqual(reasonText, undefined, `${file.toString()} has no reason text`);
    return reasonText!;
}

test("test_auto_with_both_answers_yes_ends_with_a_bounded_number_of_children", { timeout: STATEFUL_ENGINE_TIMEOUT_MILLISECONDS }, async (t) => {
    // Scenario: four files; three stop at one script; one of the three has a second stop that only a pass-stops walk passes; both answers are yes.
    const harness = buildStatefulEngineHarness(t, { runScripts: true, runModifyingScriptsAutomatically: true });
    // Run the auto walk, then wait until no more children start.
    await runAutoWalkOfHarness(harness);
    await waitUntilEverythingSettles(harness);
    // 7 step children: 4 first walks, 2 pre-play walks that pass the stops, 1 walk again of the played file.
    assert.equal(harness.stepSpawns.length, 7);
    assert.equal(harness.stepSpawns.filter((spawn) => spawn.isPassingStops).length, 2);
    // Exactly one play child ran.
    assert.equal(harness.playSpawns.length, 1);
    // Every file is Idle or Stopped; none is Crashed, Running or Queued.
    for (const file of harness.files) {
        const status = harness.getRunState(file).status;
        assert.ok(status === FileWalkStatus.Idle || status === FileWalkStatus.Stopped, `${file.toString()} has status ${status}`);
    }
    // No child runs and the pool is idle.
    assert.deepEqual(harness.pool.listRunningFiles(), []);
    await harness.pool.waitUntilIdle();
    // All four sidecars say finished.
    for (const file of harness.files) {
        assert.equal(harness.isFileWalkFinished(file), true, `${file.toString()} is not finished`);
    }
});

test("test_auto_with_the_first_answer_no_runs_no_play_and_the_play_key_runs_nothing", { timeout: STATEFUL_ENGINE_TIMEOUT_MILLISECONDS }, async (t) => {
    // Scenario: the same four files; the first answer is no.
    const harness = buildStatefulEngineHarness(t, { runScripts: false, runModifyingScriptsAutomatically: false });
    const [firstFile, secondFile, thirdFile, fourthFile] = harness.files as [Path, Path, Path, Path];
    // Run the auto walk, then wait until no more children start.
    await runAutoWalkOfHarness(harness);
    await waitUntilEverythingSettles(harness);
    // Exactly the 4 first walks ran and no play child ran.
    assert.equal(harness.stepSpawns.length, 4);
    assert.equal(harness.playSpawns.length, 0);
    // The three script files are Stopped with the refusal text; the file without a stop is Idle.
    for (const file of [firstFile, secondFile, thirdFile]) {
        assert.equal(harness.getRunState(file).status, FileWalkStatus.Stopped);
        assert.match(readReasonTextOfFile(harness, file), /scripts are not allowed in this session/);
    }
    assert.equal(harness.getRunState(fourthFile).status, FileWalkStatus.Idle);
    // Press the play key on the first file, then wait again.
    const reasonTextBeforeKey = readReasonTextOfFile(harness, firstFile);
    await harness.walker.playScript(firstFile, new Date(0));
    await waitUntilEverythingSettles(harness);
    // Still 4 step children and no play child; the first file is Stopped with the same text.
    assert.equal(harness.stepSpawns.length, 4);
    assert.equal(harness.playSpawns.length, 0);
    assert.equal(harness.getRunState(firstFile).status, FileWalkStatus.Stopped);
    assert.equal(readReasonTextOfFile(harness, firstFile), reasonTextBeforeKey);
});

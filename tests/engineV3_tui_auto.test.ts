// The --auto walk of the terminal UI: jump to the oldest event and wait until every file is done.

import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus } from "../src/structures/vocabulary.ts";
import { getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { readWalkCoverage } from "../engineV3/engineV3_walk_coverage.ts";
import { runAutoWalk } from "../engineV3/tui/engineV3_tui_auto.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import { createStepPool } from "../engineV3/tui/engineV3_tui_pool.ts";
import { createSpawnStepProcess } from "../engineV3/tui/engineV3_tui_step_process.ts";
import { createWalkState, getFileRunState, type FileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { HistoryWalker, SpawnSettings, StepPool, StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
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

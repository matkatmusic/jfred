// The real child process behind one terminal UI walk: spawn, read every chunk, map the last line.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { createSpawnStepProcess, listLiveChildProcessIds, runStepChild } from "../engineV3/tui/engineV3_tui_step_process.ts";
import type { SpawnSettings, StepProcessOutcome } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { PROJECT_FILE_NAME, makeEditRows, makeInstant, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const JFRED_FOLDER = new Path(join(import.meta.dirname, ".."));
const LIVE_CHILD_POLL_MILLISECONDS = 50;
const LIVE_CHILD_POLL_LIMIT = 100;
const STANDARD_ERROR_LINE_COUNT = 1024;
const STANDARD_ERROR_LINE_LENGTH = 1023;
const NO_RESULT_LINE_TEXT = "the process printed no result line";

// Disk text "two"; an Edit of one to two at second 20.
function writeOneEditProject(t: TestContext): Project {
    return writeProject(t, "two\n", (projectFolder, filePath) => makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 20));
}

function buildSettingsForProject(project: Project): SpawnSettings {
    return {
        projectFolder: project.projectFolder,
        jsonlsFolders: [project.jsonlsFolder],
        fileHistoryFolders: [project.snapshotFolder],
        storeFolder: project.storeFolder,
        earliestBoundary: undefined,
        jfredFolder: JFRED_FOLDER,
    };
}

function makeTemporaryFolder(t: TestContext): Path {
    const folder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-tui-step-process-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return new Path(folder);
}

function buildResultLineScript(): string {
    const resultLine = { startAt: makeInstant(0).toISOString(), outcome: InverseStepOutcome.StartAtReached, commitsWritten: 0, position: 0, commit: "abc", eventType: null, source: null };
    return `process.stdout.write(${JSON.stringify(JSON.stringify(resultLine))} + "\\n");`;
}

async function waitForNewLiveChildId(idsBefore: number[]): Promise<number> {
    for (let pollCount = 0; pollCount < LIVE_CHILD_POLL_LIMIT; pollCount++) {
        const newIds = listLiveChildProcessIds().filter((childId) => !idsBefore.includes(childId));
        if (newIds.length > 0) {
            return newIds[0]!;
        }
        await new Promise((resolve) => setTimeout(resolve, LIVE_CHILD_POLL_MILLISECONDS));
    }
    throw new Error("no new live child appeared");
}

test("test_spawnStepProcess_returns_covered_for_a_reachable_instant", async (t) => {
    // Scenario: a real child walks one file to the instant of its newest edit.
    const project = writeOneEditProject(t);
    const spawnStepProcess = createSpawnStepProcess(buildSettingsForProject(project));
    // Run the child with startAt = the instant of the newest edit (second 20).
    const outcome: StepProcessOutcome = await spawnStepProcess({ file: project.file, startAt: makeInstant(20), isPassingStops: false });
    // The stored commits already cover that instant, so the outcome is Covered.
    assert.equal(outcome.kind, StepProcessOutcomeKind.Covered);
});

test("test_spawnStepProcess_returns_finished_for_an_instant_before_every_event", async (t) => {
    // Scenario: a real child walks one file to an instant older than every event.
    const project = writeOneEditProject(t);
    const spawnStepProcess = createSpawnStepProcess(buildSettingsForProject(project));
    // Run the child with startAt = second 0, before the edit at second 20.
    const outcome: StepProcessOutcome = await spawnStepProcess({ file: project.file, startAt: makeInstant(0), isPassingStops: false });
    // The walk runs out of older changes, so the outcome is Finished.
    assert.equal(outcome.kind, StepProcessOutcomeKind.Finished);
});

test("test_spawnStepProcess_returns_crashed_for_a_bad_project_folder", async (t) => {
    // Scenario: the project folder does not exist.
    const rootFolder = makeTemporaryFolder(t);
    const missingProjectFolder = new Path(join(rootFolder.toString(), "no-such-project"));
    const settings: SpawnSettings = {
        projectFolder: missingProjectFolder,
        jsonlsFolders: [new Path(join(rootFolder.toString(), "jsonls"))],
        fileHistoryFolders: [new Path(join(rootFolder.toString(), "file-history"))],
        storeFolder: new Path(join(rootFolder.toString(), "store")),
        earliestBoundary: undefined,
        jfredFolder: JFRED_FOLDER,
    };
    const spawnStepProcess = createSpawnStepProcess(settings);
    // Run the child on a file of that missing folder.
    const missingFile = new Path(join(missingProjectFolder.toString(), PROJECT_FILE_NAME));
    const outcome = await spawnStepProcess({ file: missingFile, startAt: makeInstant(0), isPassingStops: false });
    // The child exits with an error, so the outcome is Crashed with a nonzero exit code.
    assert.ok(outcome.kind === StepProcessOutcomeKind.Crashed);
    assert.notEqual(outcome.exitCode, 0);
    assert.notEqual(outcome.exitCode, null);
});

test("test_spawnStepProcess_returns_crashed_for_a_killed_child", async (t) => {
    // Scenario: a child that never ends is killed from outside.
    const folder = makeTemporaryFolder(t);
    const idsBefore = listLiveChildProcessIds();
    const outcomePromise = runStepChild(process.execPath, ["-e", "setInterval(()=>{},1000)"], folder);
    // Read the process id of the new child from the live registry.
    const childId = await waitForNewLiveChildId(idsBefore);
    // Kill it with SIGKILL.
    process.kill(childId, "SIGKILL");
    const outcome = await outcomePromise;
    // The outcome is Crashed and names the signal.
    assert.ok(outcome.kind === StepProcessOutcomeKind.Crashed);
    assert.equal(outcome.signal, "SIGKILL");
    assert.equal(outcome.exitCode, null);
});

test("test_spawnStepProcess_returns_crashed_for_exit_zero_with_no_result_line", async (t) => {
    // Scenario: a child exits 0 and prints nothing.
    const folder = makeTemporaryFolder(t);
    const outcome = await runStepChild(process.execPath, ["-e", "process.exit(0)"], folder);
    // The outcome is Crashed with the reason text.
    assert.ok(outcome.kind === StepProcessOutcomeKind.Crashed);
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.stderrTail, NO_RESULT_LINE_TEXT);
});

test("test_spawnStepProcess_does_not_block_on_a_chatty_standard_error", async (t) => {
    // Scenario: a child writes 1 MB to standard error, then prints a valid result line.
    const folder = makeTemporaryFolder(t);
    const chattyScript = `for (let lineNumber = 0; lineNumber < ${STANDARD_ERROR_LINE_COUNT}; lineNumber++) { process.stderr.write("x".repeat(${STANDARD_ERROR_LINE_LENGTH}) + "\\n"); } ${buildResultLineScript()}`;
    const outcome = await runStepChild(process.execPath, ["-e", chattyScript], folder);
    // The child finishes (the pipe never blocks it) and the outcome is Covered.
    assert.equal(outcome.kind, StepProcessOutcomeKind.Covered);
});

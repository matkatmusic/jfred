// The TUI bar data: wires of a partial step repo, bar models, and the info row counts.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { createFileStep, isModifyingEventType, type FileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { buildTuiBarModels, describeBarInfo, listInverseRepoFileWire } from "../engineV3/tui/engineV3_tui_bars.ts";
import type { FileEventCounts, ProjectEventEntry } from "../engineV3/tui/engineV3_tui_project_cache.ts";
import { createWalkState, type FileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import { loadKeyBoxes, loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";
import { App } from "../engineV3/tui/engineV3_tui_app.tsx";
import type { AppProps } from "../engineV3/tui/engineV3_tui_app_types.ts";
import type { InverseCommitWire, InverseRepoFileWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { PROJECT_FILE_NAME, makeEditRows, makeInstant, makeWriteCreateRows, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const DEFAULT_KEYMAP_FILE = new Path(join(dirname(fileURLToPath(import.meta.url)), "..", "engineV3", "tui", "keymap.json"));
const XTERM_RIGHT_ARROW_SEQUENCE = "\x1b[C";
const DID_NOT_EXIST_YET_TEXT = "did not exist yet";
const FRAME_POLL_INTERVAL_MILLISECONDS = 10;
const FRAME_WAIT_LIMIT_MILLISECONDS = 2000;
const INK_SETTLE_MILLISECONDS = 50;

// Disk text "three"; Edit one to two at second 10, Edit two to three at second 20.
function writeTwoEditProject(t: TestContext): Project {
    return writeProject(t, "three\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
}

function startWalk(project: Project): { repoFolder: Path; fileName: string; step: FileStep } {
    const projectFiles = [{ file: project.file, transcriptFile: project.file }];
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    const fileName = basename(project.file.toString());
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    return { repoFolder, fileName, step };
}

// Newest row first: second 25, second 15, second 5.
function makeRulerRows(): RulerRow[] {
    return [25, 15, 5].map((second, rowIndex) => ({
        axisPx: rowIndex * 30,
        text: `row ${second}`,
        eventCount: 1,
        axisPxList: [rowIndex * 30],
        instants: [makeInstant(second).toISOString()],
    }));
}

function makeCommitWire(position: number, eventType: FileEventType, second: number | null): InverseCommitWire {
    return {
        commitHash: `hash${position}`,
        treeHash: `tree${position}`,
        eventType,
        moment: "at-event",
        confidence: "proven",
        position,
        instant: second === null ? null : makeInstant(second).toISOString(),
        readerInstant: second === null ? null : makeInstant(second).toISOString(),
        isFileAbsent: false,
        isRemoved: false,
        movedAwayTo: null,
    };
}

function makeThreeCommitWire(): InverseRepoFileWire {
    return {
        file: "a.txt",
        commits: [makeCommitWire(2, FileEventType.EditRow, 20), makeCommitWire(1, FileEventType.EditRow, 10), makeCommitWire(0, FileEventType.DiskNow, null)],
    };
}

// Every type holds a different power of two, so any sum names exactly the types it added.
function makeKnownCounts(): FileEventCounts {
    return {
        [FileEventType.DiskNow]: 1,
        [FileEventType.GitCommit]: 2,
        [FileEventType.BackupSnapshot]: 4,
        [FileEventType.WriteRow]: 8,
        [FileEventType.EditRow]: 16,
        [FileEventType.ReadWhole]: 32,
        [FileEventType.ReadPartial]: 64,
        [FileEventType.ScriptReadOnly]: 128,
        [FileEventType.ScriptMayWrite]: 256,
        [FileEventType.OtherRow]: 512,
        [FileEventType.UserEditNotice]: 1024,
        [FileEventType.RowBytesUnknown]: 2048,
    };
}

function makeIdleRunState(failedReplayCount: number): FileRunState {
    return { status: FileWalkStatus.Idle, reasonText: undefined, failedReplayCount };
}

test("test_models_of_a_partial_repo_have_a_dot_for_every_stored_commit", (t) => {
    // Scenario: a step repo walked twice holds the disk-now commit and the commits the two steps wrote.
    const project = writeTwoEditProject(t);
    const walked = startWalk(project);
    stepFileAndWriteCommit(walked.repoFolder, walked.fileName, walked.step, undefined);
    stepFileAndWriteCommit(walked.repoFolder, walked.fileName, walked.step, undefined);
    const storedCommitCount = listInverseCommits(walked.repoFolder, walked.fileName, false).length;
    assert.ok(storedCommitCount > 1);
    // The wire of the file holds one commit for each stored commit.
    const wire = listInverseRepoFileWire(project.storeFolder, project.projectFolder, project.file);
    assert.equal(wire.commits.length, storedCommitCount);
    assert.equal(wire.file, basename(project.file.toString()));
    // The model built from that wire holds one dot for each commit.
    const models = buildTuiBarModels([wire], makeRulerRows());
    assert.equal(models.length, 1);
    assert.equal(models[0]!.commits.length, wire.commits.length);
    assert.equal(models[0]!.dots.length, wire.commits.length);
});

test("test_info_counts_come_from_the_cache_counts_and_the_repo", () => {
    // Scenario: a model of three commits and a count object with a known number for every event type.
    const model = buildTuiBarModels([makeThreeCommitWire()], makeRulerRows())[0]!;
    const info = describeBarInfo(model, makeKnownCounts(), makeIdleRunState(3));
    // The commit count is the number of commits in the repo.
    assert.equal(info.commitCount, 3);
    // The snapshot count is the BackupSnapshot count.
    assert.equal(info.snapshotCount, 4);
    // The script count is ScriptMayWrite plus ScriptReadOnly.
    assert.equal(info.scriptCount, 256 + 128);
    // The failed replay count comes from the run state.
    assert.equal(info.failedReplayCount, 3);
    // No reason text means no error text.
    assert.equal(info.errorText, undefined);
});

test("test_info_shows_the_total_modifying_events_in_the_logs", () => {
    // Scenario: the repo holds 3 commits, while the logs hold many more modifying events.
    const model = buildTuiBarModels([makeThreeCommitWire()], makeRulerRows())[0]!;
    const counts = makeKnownCounts();
    const info = describeBarInfo(model, counts, makeIdleRunState(0));
    // The modifying event count is the sum over the modifying types only.
    const expectedModifyingEventCount = Object.values(FileEventType)
        .filter((eventType) => isModifyingEventType(eventType))
        .reduce((total, eventType) => total + counts[eventType], 0);
    assert.equal(expectedModifyingEventCount, 2 + 4 + 8 + 16 + 256 + 512 + 1024);
    assert.equal(info.modifyingEventCount, expectedModifyingEventCount);
    // The commit count stays the repo's own number.
    assert.notEqual(info.modifyingEventCount, info.commitCount);
});

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFrame(lastFrame: () => string | undefined, expectedText: string): Promise<void> {
    const pollCountLimit = FRAME_WAIT_LIMIT_MILLISECONDS / FRAME_POLL_INTERVAL_MILLISECONDS;
    for (let pollCount = 0; pollCount < pollCountLimit; pollCount++) {
        const frame = lastFrame() ?? "";
        if (frame.includes(expectedText)) {
            return;
        }
        await waitMilliseconds(FRAME_POLL_INTERVAL_MILLISECONDS);
    }
    throw new Error(`Frame never showed "${expectedText}" within ${FRAME_WAIT_LIMIT_MILLISECONDS} ms. Last frame: ${lastFrame()}`);
}

function throwBecauseNotExpected(): never {
    throw new Error("the screen called a function that this test does not expect");
}

function makeZeroEventCounts(): FileEventCounts {
    const counts = {} as FileEventCounts;
    for (const eventType of Object.values(FileEventType)) {
        counts[eventType] = 0;
    }
    return counts;
}

// A screen whose walker says every time is covered and whose pool does nothing; the wires come from the real repo.
function makeAppProps(project: Project, events: ProjectEventEntry[]): AppProps {
    return {
        // terminalRows: 20,
        terminalRows: 24,
        terminalColumns: 100,
        projectFolder: project.projectFolder,
        storeFolder: project.storeFolder,
        files: [project.file],
        events,
        countsByFile: new Map([[project.file.toString(), makeZeroEventCounts()]]),
        keymap: loadKeymap(DEFAULT_KEYMAP_FILE),
        keyBoxes: loadKeyBoxes(DEFAULT_KEYMAP_FILE),
        engineLog: { appendRawLine: () => {}, appendSummaryLine: () => {}, listLines: () => [] },
        openLogFolder: () => {},
        walkState: createWalkState(),
        // walker: { walkHistoryTo: () => true, handleOutcome: async () => {} },
        walker: { walkHistoryTo: () => true, handleOutcome: async () => {}, playScript: throwBecauseNotExpected },
        pool: {
            requestWalk: () => {},
            requestPlay: throwBecauseNotExpected,
            cancelFile: async () => {},
            cancelAll: async () => {},
            stopStarting: () => {},
            waitUntilIdle: async () => {},
            listRunningFiles: () => [],
        },
        scriptCounts: { mayWrite: 0, readOnly: 0 },
        consentAnswers: { runScripts: undefined, runModifyingScriptsAutomatically: undefined },
        staleRepoCount: 0,
        cacheStatusText: undefined,
        subscribeToStatusChanges: () => () => {},
        loadFileWire: (file) => listInverseRepoFileWire(project.storeFolder, project.projectFolder, file),
        isTimeSpannedForFile: () => true,
        onConsentAnswered: () => {},
        onResetSelectedStores: async () => {},
        onResetAllStores: async () => {},
        onPlayScript: throwBecauseNotExpected,
    };
}

test("test_a_row_of_a_file_born_after_the_marker_shows_did_not_exist_yet", async (t) => {
    // Scenario: a.txt is created by a Write at second 30; the whole history is stepped, so the repo holds the birth commit.
    const project = writeProject(t, "hello\n", (projectFolder, filePath) => makeWriteCreateRows(projectFolder, "toolu_w1", filePath, "hello\n", 30));
    const walked = startWalk(project);
    let stepOutcome: InverseStepOutcome;
    do {
        stepOutcome = stepFileAndWriteCommit(walked.repoFolder, walked.fileName, walked.step, undefined).result.outcome;
    } while (stepOutcome !== InverseStepOutcome.NoOlderChange);
    // The events are newest first: second 40, the birth at second 30, and one entry at second 10 that is older than the birth.
    const events: ProjectEventEntry[] = [
        { instant: makeInstant(40), file: project.file, eventType: FileEventType.EditRow, source: "toolu_e1" },
        { instant: makeInstant(30), file: project.file, eventType: FileEventType.WriteRow, source: "toolu_w1" },
        { instant: makeInstant(10), file: project.file, eventType: FileEventType.EditRow, source: "toolu_e0" },
    ];
    const { lastFrame, stdin, unmount } = render(createElement(App, makeAppProps(project, events)));
    t.after(() => unmount());
    // Ink reads input only after the first render effect has run, so wait a short time.
    await waitMilliseconds(INK_SETTLE_MILLISECONDS);
    // The marker starts at second 40, newer than the birth: the row does not say "did not exist yet".
    assert.ok(!(lastFrame() ?? "").includes(DID_NOT_EXIST_YET_TEXT));
    // With the a key on, Right in event speed moves the marker to second 30, and once more to second 10, older than the birth.
    stdin.write("a");
    await waitMilliseconds(INK_SETTLE_MILLISECONDS);
    stdin.write(XTERM_RIGHT_ARROW_SEQUENCE);
    await waitMilliseconds(INK_SETTLE_MILLISECONDS);
    stdin.write(XTERM_RIGHT_ARROW_SEQUENCE);
    // The screen shows the text "did not exist yet".
    await waitForFrame(lastFrame, DID_NOT_EXIST_YET_TEXT);
    // The text is on the row of a.txt.
    const fileRowLine = (lastFrame() ?? "").split("\n").find((line) => line.includes(PROJECT_FILE_NAME));
    assert.ok(fileRowLine !== undefined);
    assert.ok(fileRowLine.includes(DID_NOT_EXIST_YET_TEXT));
});

test("test_listInverseRepoFileWire_returns_no_commits_for_a_file_whose_repo_folder_does_not_exist", (t) => {
    // Scenario: a fresh empty store; the project is written but never walked, so the repo folder of a.txt is missing.
    const project = writeProject(t, "hello\n", (projectFolder, filePath) => makeWriteCreateRows(projectFolder, "toolu_w1", filePath, "hello\n", 30));
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    // The repo folder does not exist.
    assert.equal(existsSync(repoFolder.toString()), false);
    // The wire is read without a throw.
    const wire = listInverseRepoFileWire(project.storeFolder, project.projectFolder, project.file);
    // The wire holds zero commits.
    assert.equal(wire.commits.length, 0);
    // The wire names the file by its base name.
    assert.equal(wire.file, basename(project.file.toString()));
});

test("test_the_screen_shows_the_row_of_a_file_with_no_repo_in_a_fresh_empty_store", async (t) => {
    // Scenario: a fresh empty store; the project is written but never walked, so the repo folder of a.txt is missing.
    const project = writeProject(t, "hello\n", (projectFolder, filePath) => makeWriteCreateRows(projectFolder, "toolu_w1", filePath, "hello\n", 30));
    // The events are newest first and hold one event of a.txt, so the screen has a marker.
    const events: ProjectEventEntry[] = [{ instant: makeInstant(30), file: project.file, eventType: FileEventType.WriteRow, source: "toolu_w1" }];
    // The screen is drawn from the empty store.
    const { lastFrame, unmount } = render(createElement(App, makeAppProps(project, events)));
    t.after(() => unmount());
    // The screen shows the row of a.txt without a throw.
    await waitForFrame(lastFrame, PROJECT_FILE_NAME);
});

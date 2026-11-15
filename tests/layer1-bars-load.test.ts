// Test for webapp/layer1-components/bars-view/layer1-bars-load.ts: job 1, the stream, the staged reveal and the real ruler lock.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile, ensureBarsMarkup, TEST_INSTANT_MIDDLE, TEST_INSTANT_NEWEST, TEST_INSTANT_OLDEST } from "./layer1-bars-test-helpers.ts";
import { BARS_RULER_LOADING_CLASS, BARS_SELECTED_TICK_CLASS } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { BARS_HISTORY_STAGES, BARS_LAST_STAGE_INDEX } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { BARS_NO_RULER_ROWS_TEXT, BARS_READING_LOGS_TEXT } from "../webapp/layer1-components/bars-view/layer1-bars-header.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";

// layer1-page.ts boots at MODULE SCOPE (through the strip), so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { loadBarsHistory, registerBarsHistoryLoadedCallback, BARS_HISTORY_STAGE_MS, BARS_HISTORY_DONE_HOLD_MS } = await import("../webapp/layer1-components/bars-view/layer1-bars-load.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
const { loadJfredBranch, setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

const SOURCE_PARAMS = new URLSearchParams("dir=/proj");
const PROJECT_DIR = "/proj";
const STRIP_ID = "jfredCommitsDrawerComponent";
const FILE_PATH = "a.ts";
const NEWEST_ROW_TEXT = "row newest";
const CANNED_VIEW = {
    pairs: [],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [],
    jfredCommits: {
        isCanned: true as const,
        base: { instant: TEST_INSTANT_OLDEST, shortHash: "a1b2c3d4" },
        commits: [],
    },
};

const STARTED_LINE = { kind: "progress", label: "building inverse repos", current: 0, total: 2, steps: [] };
const STEP_LINE_1_OF_4 = { kind: "progress", label: "step", file: FILE_PATH, fileStepsDone: 1, fileStepsTotal: 4 };
const STEP_LINE_2_OF_4 = { kind: "progress", label: "step", file: FILE_PATH, fileStepsDone: 2, fileStepsTotal: 4 };
const DONE_LINE = { kind: "progress", label: "done", current: 1, total: 2, file: FILE_PATH, fileStepsDone: 4, fileStepsTotal: 4 };
const ERROR_LINE = { kind: "error", label: "boom" };

// Newest first: DiskNow, commit (stage 1), edit (stage 4), created (last stage).
const RESULT_LINE = {
    files: [
        buildInverseFile(FILE_PATH, [
            buildDiskNowCommit(),
            buildInverseCommit({ commitHash: "c1", eventType: "GitCommit", instant: TEST_INSTANT_NEWEST, position: 1 }),
            buildInverseCommit({ commitHash: "c2", eventType: "EditRow", instant: TEST_INSTANT_MIDDLE, position: 2 }),
            buildInverseCommit({ commitHash: "c3", eventType: "GitCommit", instant: TEST_INSTANT_OLDEST, position: 3, isFileAbsent: true }),
        ]),
    ],
};

const state = getBarsViewState();
let tickElementsOldestFirst: HTMLElement[] = [];

type WaitSnapshot = {
    milliseconds: number;
    statusText: string;
    totalDotCount: number;
    placeholderDotCount: number;
    isCommitDotPlaceholder: boolean;
    isEditDotPlaceholder: boolean;
};
type ControlledStream = { response: Response; pushLine: (line: unknown) => void; closeStream: () => void };

function buildRulerRow(text: string, instant: string): RulerRow {
    return { axisPx: 0, text, eventCount: 1, axisPxList: [0], instants: [instant] };
}

// Ticks sit oldest first in the page; the rows are stored so that the newest row is the last tick.
function fillRealRulerWithThreeRows(): HTMLElement[] {
    const ruler = document.getElementById("timelineRulerComponent")!;
    const rowsOldestFirst = [
        buildRulerRow("row oldest", TEST_INSTANT_OLDEST),
        buildRulerRow("row middle", TEST_INSTANT_MIDDLE),
        buildRulerRow(NEWEST_ROW_TEXT, TEST_INSTANT_NEWEST),
    ];
    const tickElements: HTMLElement[] = [];
    for (const row of rowsOldestFirst) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, row);
        tickElements.push(tick);
    }
    return tickElements;
}

function readLineText(lineId: string): string {
    return (document.getElementById(lineId)!.textContent ?? "").slice("==> ".length);
}

function isRulerLoading(): boolean {
    return document.getElementById("timelineRulerComponent")!.classList.contains(BARS_RULER_LOADING_CLASS);
}

function installControlledStream(): ControlledStream {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            streamController = controller;
        },
    });
    const response = { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
    const encoder = new TextEncoder();
    return {
        response,
        pushLine: (line) => streamController.enqueue(encoder.encode(JSON.stringify(line) + "\n")),
        closeStream: () => streamController.close(),
    };
}

// Each fetch call answers the next response of the list.
function installSequencedFetch(responses: Response[]): void {
    Object.assign(globalThis, {
        fetch: async (): Promise<Response> => {
            const response = responses.shift();
            if (response === undefined) {
                throw new Error("no more canned responses");
            }
            return response;
        },
    });
}

async function waitImmediately(): Promise<void> {}

function takeWaitSnapshot(milliseconds: number): WaitSnapshot {
    return {
        milliseconds,
        statusText: readLineText("barsStatusLine"),
        totalDotCount: document.querySelectorAll(".BarDot").length,
        placeholderDotCount: document.querySelectorAll(".BarDot.dotPlaceholder").length,
        isCommitDotPlaceholder: document.querySelector(".bd-commit.dotPlaceholder") !== null,
        isEditDotPlaceholder: document.querySelector(".bd-edit.dotPlaceholder") !== null,
    };
}

function buildRecordingWait(snapshots: WaitSnapshot[]): (milliseconds: number) => Promise<void> {
    return async (milliseconds) => {
        snapshots.push(takeWaitSnapshot(milliseconds));
    };
}

async function loadWithRecordedWaits(lines: unknown[]): Promise<WaitSnapshot[]> {
    const snapshots: WaitSnapshot[] = [];
    installStreamRoute("/api/layer1-inverse-repos", lines);
    await loadBarsHistory(state, SOURCE_PARAMS, buildRecordingWait(snapshots));
    return snapshots;
}

async function finishControlledLoad(stream: ControlledStream, loading: Promise<void>): Promise<void> {
    stream.pushLine(RESULT_LINE);
    stream.closeStream();
    await loading;
}

beforeEach(() => {
    initLayer1Dom();
    ensureBarsMarkup();
    tickElementsOldestFirst = fillRealRulerWithThreeRows();
    loadJfredBranch(CANNED_VIEW);
    setArmed(false);
    state.projectDir = PROJECT_DIR;
    registerBarsHistoryLoadedCallback(() => {});
});

test("test_the_first_line_shows_the_reading_logs_status_and_the_read_bar", async () => {
    // Scenario: the stream sends only its first progress line so far.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine(STARTED_LINE);
    await waitForAsyncWork();
    // The status line names the one-time log read and the read bar shows.
    assert.equal(readLineText("barsStatusLine"), BARS_READING_LOGS_TEXT);
    assert.equal(document.getElementById("barsReadBar")!.hasAttribute("hidden"), false);
    await finishControlledLoad(stream, loading);
});

test("test_a_log_file_line_shows_the_file_name_under_the_status_line", async () => {
    // Scenario: two log file lines arrive before the started line.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine({ kind: "progress", label: "a.jsonl", logFile: "a.jsonl" });
    stream.pushLine({ kind: "progress", label: "b.jsonl", logFile: "b.jsonl" });
    await waitForAsyncWork();
    // The log file line shows the newest name and is visible.
    const logFileLine = document.getElementById("barsLogFileLine")!;
    assert.equal(logFileLine.textContent, "b.jsonl");
    assert.equal(logFileLine.hasAttribute("hidden"), false);
    // The status line still reads the one-time log read text.
    assert.equal(readLineText("barsStatusLine"), BARS_READING_LOGS_TEXT);
    await finishControlledLoad(stream, loading);
});

test("test_the_started_line_hides_the_log_file_line", async () => {
    // Scenario: a log file line arrives, then the started line.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine({ kind: "progress", label: "a.jsonl", logFile: "a.jsonl" });
    stream.pushLine(STARTED_LINE);
    await waitForAsyncWork();
    // The log file line is empty and hidden.
    const logFileLine = document.getElementById("barsLogFileLine")!;
    assert.equal(logFileLine.textContent, "");
    assert.equal(logFileLine.hasAttribute("hidden"), true);
    await finishControlledLoad(stream, loading);
});

test("test_the_first_line_names_the_file_count_in_the_header", async () => {
    // Scenario: the first progress line says 2 files.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine(STARTED_LINE);
    await waitForAsyncWork();
    // The header line names 2 files.
    assert.equal(readLineText("barsHeaderLine"), "Loading change history for 2 files");
    await finishControlledLoad(stream, loading);
});

test("test_a_step_line_adds_a_row_for_its_file_and_moves_its_fill", async () => {
    // Scenario: two step lines arrive for the same file.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine(STARTED_LINE);
    stream.pushLine(STEP_LINE_1_OF_4);
    await waitForAsyncWork();
    // One row exists for the file and its fill is 1 of 4.
    assert.equal(document.querySelectorAll("#barsRowList .barsFileRow").length, 1);
    assert.equal(document.querySelector("#barsRowList .barsFilePath")!.textContent, FILE_PATH);
    assert.equal((document.querySelector("#barsRowList .barsFill") as HTMLElement).style.width, "25%");
    // The second step line moves the fill of the same row.
    stream.pushLine(STEP_LINE_2_OF_4);
    await waitForAsyncWork();
    assert.equal(document.querySelectorAll("#barsRowList .barsFileRow").length, 1);
    assert.equal((document.querySelector("#barsRowList .barsFill") as HTMLElement).style.width, "50%");
    await finishControlledLoad(stream, loading);
});

test("test_a_step_line_hides_the_read_bar", async () => {
    // Scenario: a step line arrives after the first line.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine(STARTED_LINE);
    stream.pushLine(STEP_LINE_1_OF_4);
    await waitForAsyncWork();
    // The read bar is hidden.
    assert.equal(document.getElementById("barsReadBar")!.hasAttribute("hidden"), true);
    await finishControlledLoad(stream, loading);
});

test("test_a_step_line_marks_the_row_running_and_shows_the_step_text", async () => {
    // Scenario: a step line arrives for one file.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine(STARTED_LINE);
    stream.pushLine(STEP_LINE_1_OF_4);
    await waitForAsyncWork();
    // The row is running and its right text names the step.
    assert.equal(document.querySelector("#barsRowList .barsMark")!.className, "barsMark running");
    assert.equal(document.querySelector("#barsRowList .barsColRight")!.textContent, "step 1 of 4");
    await finishControlledLoad(stream, loading);
});

test("test_a_done_line_marks_the_row_done_and_updates_the_files_done_status", async () => {
    // Scenario: a step line and then a done line arrive for one file.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    stream.pushLine(STARTED_LINE);
    stream.pushLine(STEP_LINE_1_OF_4);
    stream.pushLine(DONE_LINE);
    await waitForAsyncWork();
    // The row is done, full, and the status line counts the files done.
    assert.equal(document.querySelector("#barsRowList .barsMark")!.className, "barsMark done");
    assert.equal((document.querySelector("#barsRowList .barsFill") as HTMLElement).style.width, "100%");
    assert.equal(document.querySelector("#barsRowList .barsColRight")!.textContent, "done");
    assert.equal(readLineText("barsStatusLine"), "1 of 2 files done");
    await finishControlledLoad(stream, loading);
});

test("test_the_result_reads_the_real_ruler_rows_and_draws_the_file_rows_with_placeholder_dots", async () => {
    // Scenario: a whole stream; look at the page at the first wait, before any stage is shown.
    const snapshots = await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    const firstSnapshot = snapshots[0]!;
    // The state holds the 3 rows of the real ruler.
    assert.equal(state.rulerRows.length, 3);
    // The file has a row, and every dot is still a placeholder.
    assert.equal(document.querySelector("#barsRowList .barsFilePath")!.textContent, FILE_PATH);
    assert.equal(firstSnapshot.totalDotCount, 4);
    assert.equal(firstSnapshot.placeholderDotCount, 4);
});

test("test_the_result_marks_the_newest_real_ruler_tick_selected", async () => {
    // Scenario: a whole stream; the newest tick is the last tick in the page.
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // Only the newest tick carries the selected class.
    assert.equal(tickElementsOldestFirst[2]!.classList.contains(BARS_SELECTED_TICK_CLASS), true);
    assert.equal(tickElementsOldestFirst[0]!.classList.contains(BARS_SELECTED_TICK_CLASS), false);
    assert.equal(tickElementsOldestFirst[1]!.classList.contains(BARS_SELECTED_TICK_CLASS), false);
    assert.equal(state.selectedRowIndex, 0);
});

test("test_the_stages_show_their_texts_in_order", async () => {
    // Scenario: a whole stream; the status line is recorded at each wait.
    const snapshots = await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // The recorded texts are the stage texts, in order.
    const expectedTexts = BARS_HISTORY_STAGES.map((stage) => stage.text);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.statusText), expectedTexts);
});

test("test_a_stage_reveals_the_dots_of_its_event_kind_only", async () => {
    // Scenario: a whole stream with a commit dot (stage 1) and an edit dot (stage 4).
    const snapshots = await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // After stage 0 both dots are placeholders.
    assert.equal(snapshots[0]!.isCommitDotPlaceholder, true);
    assert.equal(snapshots[0]!.isEditDotPlaceholder, true);
    // After stage 1 the commit dot is shown and the edit dot is still a placeholder.
    assert.equal(snapshots[1]!.isCommitDotPlaceholder, false);
    assert.equal(snapshots[1]!.isEditDotPlaceholder, true);
    // After stage 4 the edit dot is shown too.
    assert.equal(snapshots[4]!.isEditDotPlaceholder, false);
});

test("test_the_last_stage_waits_the_done_hold_time", async () => {
    // Scenario: a whole stream; the argument of each wait is recorded.
    const snapshots = await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // Every stage waits the stage time, and the last waits the done hold time.
    assert.equal(snapshots.length, BARS_LAST_STAGE_INDEX + 1);
    assert.equal(snapshots[BARS_LAST_STAGE_INDEX]!.milliseconds, BARS_HISTORY_DONE_HOLD_MS);
    assert.equal(snapshots[0]!.milliseconds, BARS_HISTORY_STAGE_MS);
    assert.equal(BARS_HISTORY_STAGE_MS, 400);
    assert.equal(BARS_HISTORY_DONE_HOLD_MS, 400);
});

test("test_the_end_keeps_the_chunks_shown_and_turns_loading_off", async () => {
    // Scenario: a whole stream.
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // The chunks are shown and revealed, and loading is off.
    assert.equal(document.getElementById("barsRows")!.dataset.blocks, "shown");
    const chunks = document.querySelectorAll(".barsHistoryBlock");
    assert.equal(chunks.length, 2);
    for (const chunk of chunks) {
        assert.equal(chunk.classList.contains("blockRevealed"), true);
    }
    assert.equal(state.isHistoryLoading, false);
});

test("test_the_end_writes_the_header_with_the_file_count_and_the_newest_row_text", async () => {
    // Scenario: a whole stream with 1 file; the newest ruler row is "row newest".
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // The header names the file count and the newest row text.
    assert.equal(readLineText("barsHeaderLine"), `Change history of 1 files, back to ${NEWEST_ROW_TEXT}`);
});

test("test_the_load_puts_the_loading_class_on_the_real_ruler_from_the_start", async () => {
    // Scenario: a load starts; the stream sends no line yet.
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    assert.equal(isRulerLoading(), false);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    // The real ruler carries the loading class and the state says loading.
    assert.equal(isRulerLoading(), true);
    assert.equal(state.isHistoryLoading, true);
    await finishControlledLoad(stream, loading);
});

test("test_the_end_removes_the_loading_class_from_the_real_ruler", async () => {
    // Scenario: a whole stream.
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // The real ruler has no loading class.
    assert.equal(isRulerLoading(), false);
});

test("test_a_failed_load_removes_the_loading_class_and_turns_loading_off_and_still_throws", async () => {
    // Scenario: the stream sends an error line.
    installStreamRoute("/api/layer1-inverse-repos", [STARTED_LINE, ERROR_LINE]);
    // The load throws the label of the error line.
    await assert.rejects(loadBarsHistory(state, SOURCE_PARAMS, waitImmediately), { message: "boom" });
    // The real ruler is clickable again and loading is off.
    assert.equal(isRulerLoading(), false);
    assert.equal(state.isHistoryLoading, false);
});

test("test_a_failed_history_stream_shows_the_error_line", async () => {
    // Scenario: the stream sends an error line.
    installStreamRoute("/api/layer1-inverse-repos", [STARTED_LINE, ERROR_LINE]);
    // The load still throws.
    await assert.rejects(loadBarsHistory(state, SOURCE_PARAMS, waitImmediately), { message: "boom" });
    // The status line names the reason.
    assert.equal(document.getElementById("barsStatusLine")!.textContent, "==> Change history did not load: boom");
});

test("test_an_older_aborted_load_does_not_remove_the_loading_class_of_a_newer_load", async () => {
    // Scenario: load A waits on a stream with no line; load B starts and aborts A.
    const streamA = installControlledStream();
    const streamB = installControlledStream();
    installSequencedFetch([streamA.response, streamB.response]);
    const loadingA = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    await waitForAsyncWork();
    const loadingB = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    await loadingA;
    // Load B still runs, so the ruler keeps the loading class.
    assert.equal(isRulerLoading(), true);
    assert.equal(state.isHistoryLoading, true);
    // Load B ends: the class goes.
    await finishControlledLoad(streamB, loadingB);
    assert.equal(isRulerLoading(), false);
    assert.equal(state.isHistoryLoading, false);
});

test("test_a_newer_load_stops_an_older_load_before_its_next_stage", async () => {
    // Scenario: load A reaches its first wait and holds there.
    const streamA = installControlledStream();
    const streamB = installControlledStream();
    installSequencedFetch([streamA.response, streamB.response]);
    let waitCountOfA = 0;
    let releaseWaitOfA!: () => void;
    const gateOfA = new Promise<void>((resolve) => {
        releaseWaitOfA = resolve;
    });
    const loadingA = loadBarsHistory(state, SOURCE_PARAMS, async () => {
        waitCountOfA++;
        await gateOfA;
    });
    streamA.pushLine(RESULT_LINE);
    streamA.closeStream();
    await waitForAsyncWork();
    assert.equal(waitCountOfA, 1);
    // Load B starts and holds on a stream with no line.
    const loadingB = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    // Load A is released: it stops before the next stage.
    releaseWaitOfA();
    await loadingA;
    assert.equal(waitCountOfA, 1);
    assert.equal(readLineText("barsStatusLine"), BARS_READING_LOGS_TEXT);
    await finishControlledLoad(streamB, loadingB);
});

test("test_an_error_line_makes_the_load_throw", async () => {
    // Scenario: the stream sends an error line.
    installStreamRoute("/api/layer1-inverse-repos", [ERROR_LINE]);
    // The load throws with the label of the error line.
    await assert.rejects(loadBarsHistory(state, SOURCE_PARAMS, waitImmediately), { message: "boom" });
});

test("test_the_end_of_the_load_draws_the_cut_strip_when_commit_mode_is_on", async () => {
    // Scenario: Commit mode is on and the load waits on a stream with no line.
    setArmed(true);
    const stream = installControlledStream();
    installSequencedFetch([stream.response]);
    const loading = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    // The strip is drawn at the start; remove it to see the end draw it again.
    assert.notEqual(document.getElementById(STRIP_ID), null);
    document.getElementById(STRIP_ID)!.remove();
    await finishControlledLoad(stream, loading);
    // The strip is drawn again.
    assert.notEqual(document.getElementById(STRIP_ID), null);
});

test("test_the_loaded_callback_fires_once_after_the_result_line_with_the_project_dir", async () => {
    // Scenario: a callback is stored; the wait records how many waits happened at each call.
    const snapshots: WaitSnapshot[] = [];
    const calls: { projectDir: string; waitCountAtCall: number }[] = [];
    registerBarsHistoryLoadedCallback((projectDir) => {
        calls.push({ projectDir, waitCountAtCall: snapshots.length });
    });
    installStreamRoute("/api/layer1-inverse-repos", [STARTED_LINE, RESULT_LINE]);
    await loadBarsHistory(state, SOURCE_PARAMS, buildRecordingWait(snapshots));
    // The callback ran once, with the project dir, before the first stage wait.
    assert.deepEqual(calls, [{ projectDir: PROJECT_DIR, waitCountAtCall: 0 }]);
});

test("test_a_load_with_no_ruler_rows_draws_no_rows_and_writes_the_no_events_header", async () => {
    // Scenario: the real ruler has no ticks and the stream sends a result line with one file.
    document.getElementById("timelineRulerComponent")!.replaceChildren();
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // No file row is drawn and the state holds no models and no ruler rows.
    assert.equal(document.querySelectorAll(".barsFilePath").length, 0);
    assert.deepEqual(state.models, []);
    assert.deepEqual(state.rulerRows, []);
    assert.equal(state.selectedRowIndex, 0);
    // The state keeps the files of the result line.
    assert.equal(state.files.length, 1);
    // The header line says there are no events.
    assert.equal(readLineText("barsHeaderLine"), BARS_NO_RULER_ROWS_TEXT);
});

test("test_a_load_with_no_ruler_rows_still_fires_the_loaded_callback", async () => {
    // Scenario: the real ruler has no ticks; a callback is stored.
    const calls: string[] = [];
    registerBarsHistoryLoadedCallback((projectDir) => calls.push(projectDir));
    document.getElementById("timelineRulerComponent")!.replaceChildren();
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // The callback ran once with the project dir.
    assert.deepEqual(calls, [PROJECT_DIR]);
});

test("test_a_load_with_no_ruler_rows_clears_the_loading_class", async () => {
    // Scenario: the real ruler has no ticks.
    document.getElementById("timelineRulerComponent")!.replaceChildren();
    await loadWithRecordedWaits([STARTED_LINE, RESULT_LINE]);
    // The loading class is gone and loading is off.
    assert.equal(isRulerLoading(), false);
    assert.equal(state.isHistoryLoading, false);
});

test("test_a_failed_load_does_not_fire_the_loaded_callback", async () => {
    // Scenario: a callback is stored; the stream sends an error line.
    const calls: string[] = [];
    registerBarsHistoryLoadedCallback((projectDir) => calls.push(projectDir));
    installStreamRoute("/api/layer1-inverse-repos", [STARTED_LINE, ERROR_LINE]);
    await assert.rejects(loadBarsHistory(state, SOURCE_PARAMS, waitImmediately), { message: "boom" });
    // The callback did not run.
    assert.deepEqual(calls, []);
});

test("test_an_aborted_older_load_does_not_fire_the_loaded_callback", async () => {
    // Scenario: a callback is stored; load A waits on a stream with no line; load B starts and aborts A.
    const calls: string[] = [];
    registerBarsHistoryLoadedCallback((projectDir) => calls.push(projectDir));
    const streamA = installControlledStream();
    const streamB = installControlledStream();
    installSequencedFetch([streamA.response, streamB.response]);
    const loadingA = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    await waitForAsyncWork();
    const loadingB = loadBarsHistory(state, SOURCE_PARAMS, waitImmediately);
    await loadingA;
    // Load A ended without the callback.
    assert.deepEqual(calls, []);
    await finishControlledLoad(streamB, loadingB);
});

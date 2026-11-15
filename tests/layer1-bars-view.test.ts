// Test for webapp/layer1-components/bars-view/layer1-bars-view.ts: the controller: load, clicks, events toggle, ruler redraw refresh.

import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildNdjsonResponse } from "./webapp-fetch-test-helpers.ts";
import { buildDiskNowCommit, buildInverseCommit, buildInverseFile, ensureBarsMarkup } from "./layer1-bars-test-helpers.ts";
import { installAnimationFrameStub, installRecordingFetch } from "./layer1-drawer-test-helpers.ts";
import { buildBarFileModels, type BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { BarsViewMode } from "../webapp/layer1-components/bars-view/layer1-bars-mode.ts";
import { BARS_SELECTED_TICK_CLASS, listRealRulerRows } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { BARS_NO_RULER_ROWS_TEXT } from "../webapp/layer1-components/bars-view/layer1-bars-header.ts";
import type { InverseCommitWire, InverseRepoFileWire } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";

// layer1-page.ts boots at MODULE SCOPE (through the strip), so absorb that first boot against a throwaway DOM.
initLayer1Dom();
const { installBarsView, markBarsViewLoadNeeded, loadBarsViewIfNeeded, refreshBarsAfterRulerRedrawIfNeeded } = await import("../webapp/layer1-components/bars-view/layer1-bars-view.ts");
const { getBarsViewState } = await import("../webapp/layer1-components/bars-view/layer1-bars-state.ts");
const { setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");
const { renderBarsRowList } = await import("../webapp/layer1-components/bars-view/layer1-bars-rowlist.ts");
const { markRealRulerRowSelected } = await import("../webapp/layer1-components/bars-view/layer1-bars-ruler.ts");
const { storeRow, rowsByTick } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");
const { notifyRulerRedrawn } = await import("../webapp/layer1-components/ruler/layer1-ruler-redraw.ts");
const { setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");

initLayer1Dom();
ensureBarsMarkup();
installBarsView();

const PROJECT_DIR = "/proj";
const FILE_PATH = "a.ts";
const UNCHANGED_FILE_PATH = "b.ts";
const SELECTED_ROW_INDEX_AT_SETUP = 3;
const EVENTS_BUTTON_TEXT_DOTS = "Events: dots under bar";
const EVENTS_BUTTON_TEXT_SEGMENTS = "Events: segments in bar";
const DEFAULT_HOURS_NEWEST_FIRST = [12, 11, 10, 9, 8];

const state = getBarsViewState();
let ticksNewestFirst: HTMLElement[] = [];
let tickOwnClickCount = 0;

function buildInstantAtHour(hour: number): string {
    return `2026-11-13T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

function buildRulerRows(hoursNewestFirst: number[]): RulerRow[] {
    return hoursNewestFirst.map((hour) => ({ axisPx: 0, text: `row ${hour}`, eventCount: 1, axisPxList: [0], instants: [buildInstantAtHour(hour)] }));
}

// Ticks sit oldest first in the page. Each tick counts the clicks that reach its own listener.
function buildRealRuler(hoursNewestFirst: number[]): void {
    const ruler = document.getElementById("timelineRulerComponent")!;
    ruler.replaceChildren();
    ticksNewestFirst = [];
    for (const row of buildRulerRows(hoursNewestFirst).reverse()) {
        const tick = document.createElement("div");
        tick.className = "tick";
        tick.addEventListener("click", () => {
            tickOwnClickCount += 1;
        });
        ruler.appendChild(tick);
        storeRow(tick, row);
        ticksNewestFirst.unshift(tick);
    }
}

function buildCommitAtHour(hour: number, overrides: Partial<InverseCommitWire> = {}): InverseCommitWire {
    return buildInverseCommit({ commitHash: `c${hour}`, instant: buildInstantAtHour(hour), ...overrides });
}

// Dots: 0 disk (row 0), 1 commit (row 1), 2 edit (row 2), 3 created (row 4).
function buildChangedFile(): InverseRepoFileWire {
    const commits = [
        buildDiskNowCommit(),
        buildCommitAtHour(11),
        buildCommitAtHour(10, { eventType: "EditRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ];
    return buildInverseFile(FILE_PATH, commits);
}

function buildUnchangedFile(): InverseRepoFileWire {
    return buildInverseFile(UNCHANGED_FILE_PATH, [buildDiskNowCommit()]);
}

function buildChangedModel(): BarFileModel {
    const model = buildBarFileModels([buildChangedFile()], buildRulerRows(DEFAULT_HOURS_NEWEST_FIRST))[0];
    assert.ok(model);
    return model;
}

function buildUnchangedModel(): BarFileModel {
    const model = buildBarFileModels([buildUnchangedFile()], buildRulerRows(DEFAULT_HOURS_NEWEST_FIRST))[0];
    assert.ok(model);
    return model;
}

function buildResultLine(): { files: unknown[] } {
    const commits = [
        buildDiskNowCommit(),
        buildCommitAtHour(11),
        buildCommitAtHour(10, { eventType: "EditRow" }),
        buildCommitAtHour(8, { eventType: "WriteRow", isFileAbsent: true }),
    ];
    return { files: [buildInverseFile(FILE_PATH, commits)] };
}

function installRecordingStreamRoute(lines: unknown[]): URL[] {
    const requestedUrls: URL[] = [];
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            requestedUrls.push(new URL(String(url), "http://localhost:7343"));
            return buildNdjsonResponse(lines);
        },
    });
    return requestedUrls;
}

// The stage waits of the load become immediate; afterEach restores the timer.
function makeTimersImmediate(): void {
    mock.method(globalThis, "setTimeout", ((callback: () => void) => {
        callback();
        return 0;
    }) as unknown as typeof setTimeout);
}

function findRequired(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    assert.ok(found, selector);
    return found;
}

function findDot(fileIndex: number, dotIndex: number): HTMLElement {
    return findRequired(`.BarDot[data-file-index="${fileIndex}"][data-dot-index="${dotIndex}"]`);
}

function dispatchShiftClick(element: HTMLElement): void {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
}

function isDetailsPaneOpen(): boolean {
    return document.getElementById("detailsPaneContainer")!.classList.contains("open");
}

function readSelectedTickInstants(): string[] {
    const selectedTicks = document.querySelectorAll<HTMLElement>(`#timelineRulerComponent .tick.${BARS_SELECTED_TICK_CLASS}`);
    return [...selectedTicks].map((tick) => rowsByTick.get(tick)!.instants[0]!);
}

function readBlocksAttribute(): string | null {
    return findRequired("#barsRows").getAttribute("data-blocks");
}

beforeEach(() => {
    installAnimationFrameStub();
    installRecordingFetch(() => ({ text: "state text" }));
    tickOwnClickCount = 0;
    buildRealRuler(DEFAULT_HOURS_NEWEST_FIRST);
    setBarsViewMode(BarsViewMode.bars);
    setArmed(false);
    (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
    document.getElementById("detailsPaneContainer")!.classList.remove("open");
    document.getElementById("barsTimelineArea")!.classList.remove("eventsInBar");
    document.getElementById("barsEventsViewButton")!.textContent = EVENTS_BUTTON_TEXT_DOTS;
    state.isLoadNeeded = false;
    state.isHistoryLoading = false;
    state.isFoldShown = true;
    state.isEventsInBar = false;
    state.projectDir = PROJECT_DIR;
    state.rulerRows = listRealRulerRows();
    state.files = [buildChangedFile(), buildUnchangedFile()];
    state.models = [buildChangedModel(), buildUnchangedModel()];
    state.selectedRowIndex = SELECTED_ROW_INDEX_AT_SETUP;
    state.selectedDotElement = undefined;
    state.isRulerRefreshNeeded = false;
    markRealRulerRowSelected(SELECTED_ROW_INDEX_AT_SETUP);
    findRequired("#barsRows").setAttribute("data-blocks", "shown");
    renderBarsRowList(state, false);
});

afterEach(() => {
    mock.restoreAll();
});

test("test_clicking_a_dot_marks_it_selected_and_opens_the_details_pane", () => {
    // Scenario: the page shows a changed file with four dots and the details pane is closed.
    const dotElement = findDot(0, 1);
    assert.equal(isDetailsPaneOpen(), false);
    // Click the commit dot.
    dotElement.click();
    // The dot carries the selected mark, the state holds it, and the pane is open.
    assert.ok(dotElement.classList.contains("selectedDot"));
    assert.equal(state.selectedDotElement, dotElement);
    assert.equal(isDetailsPaneOpen(), true);
});

test("test_clicking_another_dot_moves_the_selected_mark", () => {
    // Scenario: the commit dot is selected.
    const firstDot = findDot(0, 1);
    const secondDot = findDot(0, 2);
    firstDot.click();
    // Click the edit dot.
    secondDot.click();
    // Only the edit dot carries the selected mark.
    assert.equal(firstDot.classList.contains("selectedDot"), false);
    assert.ok(secondDot.classList.contains("selectedDot"));
    assert.equal(document.querySelectorAll(".selectedDot").length, 1);
});

test("test_shift_clicking_a_dot_selects_the_real_ruler_tick_that_holds_the_dot_time", () => {
    // Scenario: row 3 is selected; the commit dot sits on row 1 (11:00).
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(9)]);
    // Shift-click the commit dot.
    dispatchShiftClick(findDot(0, 1));
    // The 11:00 tick is the only selected tick, the state holds row 1, and the details pane stays closed.
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(11)]);
    assert.equal(state.selectedRowIndex, 1);
    assert.equal(isDetailsPaneOpen(), false);
});

test("test_clicking_a_file_name_opens_the_details_pane_for_that_file", () => {
    // Scenario: the details pane is closed.
    assert.equal(isDetailsPaneOpen(), false);
    // Click the file name of the changed file.
    findRequired('.barsFilePath[data-file-index="0"]').click();
    // The pane is open and names the file.
    assert.equal(isDetailsPaneOpen(), true);
    assert.equal(document.getElementById("dpath")!.textContent, FILE_PATH);
});

test("test_clicking_the_fold_line_hides_the_folded_files", () => {
    // Scenario: one file has no change since row 3, so the fold line shows with the folded list shown.
    const foldedList = findRequired(".barsFoldedList");
    assert.notEqual(foldedList.style.display, "none");
    // Click the fold line.
    findRequired(".barsFoldLine").click();
    // The folded list hides and the toggle reads [show].
    assert.equal(findRequired(".barsFoldedList").style.display, "none");
    assert.equal(findRequired(".barsFoldToggle").textContent, "[show]");
});

test("test_the_events_button_switches_between_dots_under_bar_and_segments_in_bar", () => {
    // Scenario: the button reads dots under bar.
    const button = findRequired("#barsEventsViewButton");
    // Click it once.
    button.click();
    // The area has the eventsInBar class and the button reads segments in bar.
    assert.ok(findRequired("#barsTimelineArea").classList.contains("eventsInBar"));
    assert.equal(button.textContent, EVENTS_BUTTON_TEXT_SEGMENTS);
    // Click it again.
    button.click();
    // The class is gone and the button reads dots under bar.
    assert.equal(findRequired("#barsTimelineArea").classList.contains("eventsInBar"), false);
    assert.equal(button.textContent, EVENTS_BUTTON_TEXT_DOTS);
});

test("test_loading_runs_in_bubbles_view_too", async () => {
    // Scenario: Bubbles view is on and a load is marked as needed.
    setBarsViewMode(BarsViewMode.bubbles);
    const requestedUrls = installRecordingStreamRoute([buildResultLine()]);
    makeTimersImmediate();
    markBarsViewLoadNeeded();
    // Run the load.
    await loadBarsViewIfNeeded();
    // The request is sent.
    assert.equal(requestedUrls.length, 1);
});

test("test_loading_does_nothing_until_the_view_marked_a_load_as_needed", async () => {
    // Scenario: no load is marked as needed.
    const requestedUrls = installRecordingStreamRoute([buildResultLine()]);
    // Run the load.
    await loadBarsViewIfNeeded();
    // No request is sent.
    assert.equal(requestedUrls.length, 0);
});

test("test_loading_sends_one_inverse_repos_request_with_dir_and_progress", async () => {
    // Scenario: a load is marked as needed and the dir box holds the project.
    const requestedUrls = installRecordingStreamRoute([buildResultLine()]);
    makeTimersImmediate();
    markBarsViewLoadNeeded();
    // Run the load.
    await loadBarsViewIfNeeded();
    // One request goes to the inverse repos route with dir and progress=1.
    assert.equal(requestedUrls.length, 1);
    assert.equal(requestedUrls[0]!.pathname, "/api/layer1-inverse-repos");
    assert.equal(requestedUrls[0]!.searchParams.get("dir"), PROJECT_DIR);
    assert.equal(requestedUrls[0]!.searchParams.get("progress"), "1");
});

test("test_loading_a_second_time_without_a_new_mark_sends_no_request", async () => {
    // Scenario: one load has run.
    const requestedUrls = installRecordingStreamRoute([buildResultLine()]);
    makeTimersImmediate();
    markBarsViewLoadNeeded();
    await loadBarsViewIfNeeded();
    // Run the load again with no new mark.
    await loadBarsViewIfNeeded();
    // Still only one request.
    assert.equal(requestedUrls.length, 1);
});

test("test_after_the_history_loads_clicking_a_real_ruler_tick_selects_its_row", async () => {
    // Scenario: a load finishes.
    installRecordingStreamRoute([buildResultLine()]);
    makeTimersImmediate();
    markBarsViewLoadNeeded();
    await loadBarsViewIfNeeded();
    // Click the 10:00 tick (row 2).
    ticksNewestFirst[2]!.click();
    // The state holds row 2 and only the 10:00 tick is selected.
    assert.equal(state.selectedRowIndex, 2);
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(10)]);
});

test("test_the_first_click_on_a_real_ruler_tick_after_the_load_hides_the_chunks", async () => {
    // Scenario: a load finishes and the chunks stay shown.
    installRecordingStreamRoute([buildResultLine()]);
    makeTimersImmediate();
    markBarsViewLoadNeeded();
    await loadBarsViewIfNeeded();
    assert.equal(readBlocksAttribute(), "shown");
    // Click a tick.
    ticksNewestFirst[2]!.click();
    // The chunks hide.
    assert.equal(readBlocksAttribute(), "hidden");
});

test("test_a_shift_click_on_a_dot_while_the_history_loads_selects_no_row", () => {
    // Scenario: the history is loading and row 3 is selected.
    state.isHistoryLoading = true;
    // Shift-click the commit dot (row 1).
    dispatchShiftClick(findDot(0, 1));
    // The selected row and the selected tick stay.
    assert.equal(state.selectedRowIndex, SELECTED_ROW_INDEX_AT_SETUP);
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(9)]);
});

test("test_clicking_a_real_ruler_tick_in_bars_view_does_not_run_the_tick_own_click", () => {
    // Scenario: Bars view is on and Commit mode is off.
    // Click a tick.
    ticksNewestFirst[1]!.click();
    // The Bars view selected the row and the tick's own listener did not run.
    assert.equal(state.selectedRowIndex, 1);
    assert.equal(tickOwnClickCount, 0);
});

test("test_clicking_a_real_ruler_tick_in_bubbles_view_runs_the_tick_own_click", () => {
    // Scenario: Bubbles view is on.
    setBarsViewMode(BarsViewMode.bubbles);
    // Click a tick.
    ticksNewestFirst[1]!.click();
    // The tick's own listener ran and the Bars view kept its selected row.
    assert.equal(tickOwnClickCount, 1);
    assert.equal(state.selectedRowIndex, SELECTED_ROW_INDEX_AT_SETUP);
});

test("test_clicking_a_real_ruler_tick_in_commit_mode_does_not_run_the_bars_click_handler", () => {
    // Scenario: Bars view is on and Commit mode is armed.
    setArmed(true);
    // Click a tick.
    ticksNewestFirst[1]!.click();
    // The tick's own listener ran and the Bars view kept its selected row.
    assert.equal(tickOwnClickCount, 1);
    assert.equal(state.selectedRowIndex, SELECTED_ROW_INDEX_AT_SETUP);
});

test("test_a_ruler_redraw_reads_the_rows_again_and_keeps_the_selected_time_selected", () => {
    // Scenario: row 3 (09:00) is selected; the ruler is drawn again with a newer 13:00 row on top.
    buildRealRuler([13, ...DEFAULT_HOURS_NEWEST_FIRST]);
    // The ruler tells the page.
    notifyRulerRedrawn();
    // The state holds six rows, 09:00 moved to row 4, and only the 09:00 tick is selected.
    assert.equal(state.rulerRows.length, 6);
    assert.equal(state.selectedRowIndex, 4);
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(9)]);
    assert.equal(state.isRulerRefreshNeeded, false);
});

test("test_a_ruler_redraw_that_removes_the_selected_row_selects_the_nearest_older_row", () => {
    // Scenario: row 3 (09:00) is selected; the ruler is drawn again without the 09:00 row.
    buildRealRuler([12, 11, 10, 8]);
    // The ruler tells the page.
    notifyRulerRedrawn();
    // The 08:00 row (the nearest older row) is selected.
    assert.equal(state.selectedRowIndex, 3);
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(8)]);
});

test("test_a_ruler_redraw_before_the_history_result_does_nothing", () => {
    // Scenario: no history result yet; the ruler is drawn again with six rows.
    state.files = [];
    buildRealRuler([13, ...DEFAULT_HOURS_NEWEST_FIRST]);
    // The ruler tells the page.
    notifyRulerRedrawn();
    // The state keeps its five old rows and asks for no refresh.
    assert.equal(state.rulerRows.length, 5);
    assert.equal(state.isRulerRefreshNeeded, false);
});

test("test_a_ruler_redraw_to_no_rows_draws_no_rows_and_writes_the_no_events_header", () => {
    // Scenario: row 3 is selected; the ruler is drawn again with no rows.
    buildRealRuler([]);
    // The ruler tells the page.
    notifyRulerRedrawn();
    // No file row is drawn, the state holds no rows and no models, and row 0 is selected.
    assert.equal(document.querySelectorAll(".barsFilePath").length, 0);
    assert.deepEqual(state.rulerRows, []);
    assert.deepEqual(state.models, []);
    assert.equal(state.selectedRowIndex, 0);
    // The header line says there are no events and no refresh is waiting.
    assert.equal((document.getElementById("barsHeaderLine")!.textContent ?? "").slice("==> ".length), BARS_NO_RULER_ROWS_TEXT);
    assert.equal(state.isRulerRefreshNeeded, false);
});

test("test_a_ruler_redraw_from_no_rows_to_rows_draws_the_file_rows", () => {
    // Scenario: the ruler had no rows, so the state holds no rows and no models; the files are kept.
    buildRealRuler([]);
    notifyRulerRedrawn();
    assert.equal(document.querySelectorAll(".barsFilePath").length, 0);
    // The ruler is drawn again with five rows.
    buildRealRuler(DEFAULT_HOURS_NEWEST_FIRST);
    notifyRulerRedrawn();
    // The state holds five rows and two models, row 0 is selected, and the changed file is drawn.
    assert.equal(state.rulerRows.length, 5);
    assert.equal(state.models.length, 2);
    assert.equal(state.selectedRowIndex, 0);
    assert.deepEqual(readSelectedTickInstants(), [buildInstantAtHour(12)]);
    assert.equal(document.querySelectorAll(".barsFilePath").length > 0, true);
});

test("test_a_ruler_redraw_in_bubbles_view_waits_until_bars_view_is_on", () => {
    // Scenario: Bubbles view is on; the ruler is drawn again with six rows.
    setBarsViewMode(BarsViewMode.bubbles);
    buildRealRuler([13, ...DEFAULT_HOURS_NEWEST_FIRST]);
    // The ruler tells the page.
    notifyRulerRedrawn();
    // The state keeps its five rows and asks for a refresh later.
    assert.equal(state.rulerRows.length, 5);
    assert.equal(state.isRulerRefreshNeeded, true);
    // The user moves to Bars view and the refresh runs.
    setBarsViewMode(BarsViewMode.bars);
    refreshBarsAfterRulerRedrawIfNeeded();
    // The state holds six rows and the 09:00 tick is selected at row 4.
    assert.equal(state.rulerRows.length, 6);
    assert.equal(state.selectedRowIndex, 4);
    assert.equal(state.isRulerRefreshNeeded, false);
});

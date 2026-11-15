import { getInputById, getRequiredElementById } from "../../app-dom.ts";
import { readSourceParams } from "../top-bars/layer1-sources.ts";
import { readJfredBranch } from "../commits-column/layer1-jfred-state.ts";
import { registerRulerRedrawListener } from "../ruler/layer1-ruler-redraw.ts";
import { openBarDotDetails, openBarFileDetails } from "./layer1-bars-details.ts";
import { loadBarsHistory } from "./layer1-bars-load.ts";
import { buildBarFileModels, type BarFileModel } from "./layer1-bars-model.ts";
import { isBarsViewOn } from "./layer1-bars-mode.ts";
import { revealBarsHistoryStage } from "./layer1-bars-row.ts";
import { renderBarsRowList, toggleBarsFold } from "./layer1-bars-rowlist.ts";
import { findRealRulerTickRowIndex, findRulerRowIndexForSelectedTime, listRealRulerRows, markRealRulerRowSelected, scrollRealRulerRowIntoView } from "./layer1-bars-ruler.ts";
import { selectBarsRow } from "./layer1-bars-select.ts";
import { getBarsViewState, type BarsViewState } from "./layer1-bars-state.ts";
import { BARS_LAST_STAGE_INDEX, type InverseRepoFileWire } from "./layer1-bars-wire.ts";

const SELECTED_DOT_CLASS = "selectedDot";
const EVENTS_IN_BAR_CLASS = "eventsInBar";
const EVENTS_BUTTON_TEXT_DOTS = "Events: dots under bar";
const EVENTS_BUTTON_TEXT_SEGMENTS = "Events: segments in bar";

export function markBarsViewLoadNeeded(): void {
    getBarsViewState().isLoadNeeded = true;
}

export async function loadBarsViewIfNeeded(): Promise<void> {
    const state = getBarsViewState();
    if (!state.isLoadNeeded) {
        return;
    }
    state.isLoadNeeded = false;
    state.projectDir = getInputById("dir").value.trim();
    const sourceParams = readSourceParams();
    if (!sourceParams.has("dir")) {
        return;
    }
    await loadBarsHistory(state, sourceParams);
}

function handleRealRulerClick(event: Event): void {
    if (!isBarsViewOn()) {
        return;
    }
    if (readJfredBranch().isArmed) {
        return;
    }
    const target = event.target as HTMLElement;
    const tick = target.closest<HTMLElement>(".tick");
    if (tick === null) {
        return;
    }
    if (target.closest(".tickfiles") !== null) {
        return;
    }
    event.stopPropagation();
    selectBarsRow(getBarsViewState(), findRealRulerTickRowIndex(tick));
}

function findFileModel(state: BarsViewState, element: HTMLElement): BarFileModel {
    const fileIndex = Number(element.getAttribute("data-file-index"));
    const model = state.models[fileIndex];
    if (model === undefined) {
        throw new Error(`no file model at index ${fileIndex}`);
    }
    return model;
}

function clearSelectedDot(state: BarsViewState): void {
    state.selectedDotElement?.classList.remove(SELECTED_DOT_CLASS);
    state.selectedDotElement = undefined;
}

function handleBarDotClick(state: BarsViewState, dotElement: HTMLElement, isShiftKey: boolean): void {
    const model = findFileModel(state, dotElement);
    const dotIndex = Number(dotElement.getAttribute("data-dot-index"));
    const dot = model.dots[dotIndex];
    if (dot === undefined) {
        throw new Error(`no dot at index ${dotIndex} in ${model.path}`);
    }
    if (isShiftKey) {
        scrollRealRulerRowIntoView(dot.rowIndex);
        selectBarsRow(state, dot.rowIndex);
        return;
    }
    clearSelectedDot(state);
    dotElement.classList.add(SELECTED_DOT_CLASS);
    state.selectedDotElement = dotElement;
    openBarDotDetails(model, dotIndex, state.projectDir);
}

function handleBarsRowsClick(event: Event): void {
    const state = getBarsViewState();
    const target = event.target as HTMLElement;
    const dotElement = target.closest<HTMLElement>(".BarDot");
    if (dotElement !== null) {
        handleBarDotClick(state, dotElement, (event as MouseEvent).shiftKey);
        return;
    }
    const pathElement = target.closest<HTMLElement>(".barsFilePath");
    if (pathElement !== null) {
        clearSelectedDot(state);
        openBarFileDetails(findFileModel(state, pathElement), state.selectedRowIndex, state.projectDir);
        return;
    }
    if (target.closest(".barsFoldLine") !== null) {
        toggleBarsFold(state);
    }
}

function toggleBarsEventsView(): void {
    const state = getBarsViewState();
    state.isEventsInBar = !state.isEventsInBar;
    getRequiredElementById("barsTimelineArea").classList.toggle(EVENTS_IN_BAR_CLASS, state.isEventsInBar);
    getRequiredElementById("barsEventsViewButton").textContent = state.isEventsInBar ? EVENTS_BUTTON_TEXT_SEGMENTS : EVENTS_BUTTON_TEXT_DOTS;
}

function refreshBarsAfterRulerRedraw(): void {
    const state = getBarsViewState();
    if (state.models.length === 0) {
        return;
    }
    if (state.isHistoryLoading) {
        return;
    }
    if (!isBarsViewOn()) {
        state.isRulerRefreshNeeded = true;
        return;
    }
    const selectedRow = state.rulerRows[state.selectedRowIndex];
    if (selectedRow === undefined) {
        throw new Error(`no ruler row at index ${state.selectedRowIndex}`);
    }
    const selectedTime = selectedRow.instants[selectedRow.instants.length - 1];
    if (selectedTime === undefined) {
        throw new Error(`ruler row ${state.selectedRowIndex} has no instants`);
    }
    const files: InverseRepoFileWire[] = [];
    for (const model of state.models) {
        files.push({ file: model.path, commits: model.commits });
    }
    state.rulerRows = listRealRulerRows();
    state.models = buildBarFileModels(files, state.rulerRows);
    state.selectedRowIndex = findRulerRowIndexForSelectedTime(state.rulerRows, selectedTime);
    markRealRulerRowSelected(state.selectedRowIndex);
    renderBarsRowList(state, false);
    if (getRequiredElementById("barsRows").getAttribute("data-blocks") === "shown") {
        const rowListElement = getRequiredElementById("barsRowList");
        for (let stageIndex = 0; stageIndex <= BARS_LAST_STAGE_INDEX; stageIndex++) {
            revealBarsHistoryStage(rowListElement, stageIndex);
        }
    }
    state.isRulerRefreshNeeded = false;
}

export function refreshBarsAfterRulerRedrawIfNeeded(): void {
    if (!getBarsViewState().isRulerRefreshNeeded) {
        return;
    }
    if (!isBarsViewOn()) {
        return;
    }
    refreshBarsAfterRulerRedraw();
}

export function installBarsView(): void {
    getRequiredElementById("barsRows").addEventListener("click", handleBarsRowsClick);
    getRequiredElementById("barsEventsViewButton").addEventListener("click", toggleBarsEventsView);
    getRequiredElementById("timelineRulerComponent").addEventListener("click", handleRealRulerClick, true);
    registerRulerRedrawListener(refreshBarsAfterRulerRedraw);
}

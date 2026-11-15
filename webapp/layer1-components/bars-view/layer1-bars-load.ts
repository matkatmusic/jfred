import { getRequiredElementById } from "../../app-dom.ts";
import { repaintCutMarks } from "../commits-column/layer1-cut-paint.ts";
import { refreshJfredStrip } from "../commits-column/layer1-jfred-strip.ts";
import { BARS_NO_RULER_ROWS_TEXT, BARS_READING_LOGS_TEXT, describeFilesDoneStatus, describeLoadingHeader, describeSelectedHeader, setBarsHeaderLine, setBarsStatusLine, showBarsReadBar } from "./layer1-bars-header.ts";
import { buildBarFileModels, describeStreamStep } from "./layer1-bars-model.ts";
import { BarRowMark, buildStreamBarRow, revealBarsHistoryStage, setBarRowFillPercent, setBarRowMark, setBarRowRightText, type BarRowElements } from "./layer1-bars-row.ts";
import { renderBarsRowList } from "./layer1-bars-rowlist.ts";
import { listRealRulerRows, markRealRulerRowSelected, setRealRulerLoading } from "./layer1-bars-ruler.ts";
import type { BarsViewState } from "./layer1-bars-state.ts";
import { buildInverseReposUrl, readInverseReposStream } from "./layer1-bars-stream.ts";
import { BARS_HISTORY_STAGES, BARS_LAST_STAGE_INDEX, classifyInverseProgressLine, InverseProgressLineKind, type InverseProgressLine } from "./layer1-bars-wire.ts";

export const BARS_HISTORY_STAGE_MS = 400;
export const BARS_HISTORY_DONE_HOLD_MS = 400;

let loadController: AbortController | undefined;
let historyLoadedCallback: ((projectDir: string) => void) | undefined;

// Stores one callback; a second call replaces it. loadBarsHistory calls it once per successful load.
export function registerBarsHistoryLoadedCallback(callback: (projectDir: string) => void): void {
    historyLoadedCallback = callback;
}

function waitForMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readDefinedValue<T>(value: T | undefined, valueName: string): T {
    if (value === undefined) {
        throw new Error(`a progress line has no ${valueName}`);
    }
    return value;
}

function getOrCreateStreamRow(streamRowsByFile: Map<string, BarRowElements>, rowListElement: HTMLElement, file: string): BarRowElements {
    const existingRow = streamRowsByFile.get(file);
    if (existingRow !== undefined) {
        return existingRow;
    }
    const newRow = buildStreamBarRow(file);
    rowListElement.append(newRow.rowElement);
    streamRowsByFile.set(file, newRow);
    return newRow;
}

function setBarsLogFileLine(fileName: string): void {
    const logFileLineElement = getRequiredElementById("barsLogFileLine");
    logFileLineElement.textContent = fileName;
    logFileLineElement.hidden = fileName === "";
}

function showProgressLine(line: InverseProgressLine, streamRowsByFile: Map<string, BarRowElements>, rowListElement: HTMLElement): void {
    const lineKind = classifyInverseProgressLine(line);
    if (lineKind === InverseProgressLineKind.logFile) {
        setBarsLogFileLine(readDefinedValue(line.logFile, "logFile"));
        return;
    }
    if (lineKind === InverseProgressLineKind.started) {
        setBarsLogFileLine("");
        setBarsHeaderLine(describeLoadingHeader(line.total));
        return;
    }
    if (lineKind === InverseProgressLineKind.fileStep) {
        showBarsReadBar(false);
        const stepRow = getOrCreateStreamRow(streamRowsByFile, rowListElement, readDefinedValue(line.file, "file"));
        setBarRowMark(stepRow, BarRowMark.running);
        const fileStepsDone = readDefinedValue(line.fileStepsDone, "fileStepsDone");
        const fileStepsTotal = readDefinedValue(line.fileStepsTotal, "fileStepsTotal");
        setBarRowFillPercent(stepRow, (fileStepsDone / fileStepsTotal) * 100);
        setBarRowRightText(stepRow, describeStreamStep(fileStepsDone, fileStepsTotal));
        return;
    }
    if (lineKind === InverseProgressLineKind.fileDone) {
        const doneRow = getOrCreateStreamRow(streamRowsByFile, rowListElement, readDefinedValue(line.file, "file"));
        setBarRowMark(doneRow, BarRowMark.done);
        setBarRowFillPercent(doneRow, 100);
        setBarRowRightText(doneRow, "done");
        setBarsStatusLine(describeFilesDoneStatus(readDefinedValue(line.current, "current"), readDefinedValue(line.total, "total")));
        return;
    }
    setBarsStatusLine(line.label);
}

function writeLoadFailedStatusLine(state: BarsViewState, runId: number, error: unknown): void {
    if (state.runId === runId) {
        setBarsLogFileLine("");
        const reason = error instanceof Error ? error.message : String(error);
        setBarsStatusLine(`Change history did not load: ${reason}`);
    }
}

// Job 1. After the staged reveal the chunks stay shown, state.isHistoryLoading is false and the real ruler rows are clickable again. At the end of the load the header line is written, the cut strip is redrawn, and the stored loaded callback runs once per successful load.
export async function loadBarsHistory(
    state: BarsViewState,
    sourceParams: URLSearchParams,
    waitMilliseconds: (milliseconds: number) => Promise<void> = waitForMilliseconds,
): Promise<void> {
    state.runId += 1;
    const runId = state.runId;
    state.isHistoryLoading = true;
    state.rulerRows = [];
    state.models = [];
    state.rowElements = [];
    getRequiredElementById("barsRows").dataset.blocks = "shown";
    setRealRulerLoading(true);
    const rowListElement = getRequiredElementById("barsRowList");
    rowListElement.replaceChildren();
    refreshJfredStrip();
    repaintCutMarks();
    if (loadController !== undefined) {
        loadController.abort();
    }
    const controller = new AbortController();
    loadController = controller;
    setBarsHeaderLine(describeLoadingHeader(undefined));
    setBarsStatusLine(BARS_READING_LOGS_TEXT);
    setBarsLogFileLine("");
    showBarsReadBar(true);
    try {
        const streamRowsByFile = new Map<string, BarRowElements>();
        const result = await readInverseReposStream(
            buildInverseReposUrl(sourceParams),
            (line) => showProgressLine(line, streamRowsByFile, rowListElement),
            controller.signal,
        );
        if (result === undefined) {
            return;
        }
        if (state.runId !== runId) {
            return;
        }
        state.files = result.files;
        state.rulerRows = listRealRulerRows();
        if (state.rulerRows.length === 0) {
            state.models = [];
            state.selectedRowIndex = 0;
        } else {
            state.models = buildBarFileModels(result.files, state.rulerRows);
            state.selectedRowIndex = 0;
            markRealRulerRowSelected(0);
        }
        if (state.runId === runId) {
            if (historyLoadedCallback !== undefined) {
                historyLoadedCallback(state.projectDir);
            }
        }
        refreshJfredStrip();
        repaintCutMarks();
        showBarsReadBar(false);
        renderBarsRowList(state, true);
        for (const [stageIndex, stage] of BARS_HISTORY_STAGES.entries()) {
            if (state.runId !== runId) {
                return;
            }
            setBarsStatusLine(stage.text);
            revealBarsHistoryStage(rowListElement, stageIndex);
            await waitMilliseconds(stageIndex === BARS_LAST_STAGE_INDEX ? BARS_HISTORY_DONE_HOLD_MS : BARS_HISTORY_STAGE_MS);
        }
    } catch (error) {
        writeLoadFailedStatusLine(state, runId, error);
        throw error;
    } finally {
        if (state.runId === runId) {
            state.isHistoryLoading = false;
            refreshJfredStrip();
            repaintCutMarks();
            setRealRulerLoading(false);
        }
    }
    if (state.runId !== runId) {
        return;
    }
    const newestRulerRow = state.rulerRows[0];
    if (newestRulerRow === undefined) {
        setBarsHeaderLine(BARS_NO_RULER_ROWS_TEXT);
        return;
    }
    setBarsHeaderLine(describeSelectedHeader(state.models.length, newestRulerRow.text));
}

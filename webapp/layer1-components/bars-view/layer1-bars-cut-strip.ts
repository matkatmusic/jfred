import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { JfredEntryKind, listJfredEntries } from "../commits-column/layer1-jfred-entries.ts";
import { readJfredBranch, readTipMs } from "../commits-column/layer1-jfred-state.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";
import { listBarsMarkableRowIndexes } from "./layer1-bars-cut-facts.ts";
import { isBarsViewOn } from "./layer1-bars-mode.ts";
import { computeBarPercent, findRealRulerTickAtRowIndex, findRulerRowIndexForInstant, listRealRulerRows, scrollRealRulerRowIntoView } from "./layer1-bars-ruler.ts";
import { getBarsViewState } from "./layer1-bars-state.ts";

export const BARS_CUT_STRIP_ID = "barsCutStrip";
export type BarsCutStripHandlers = { commitPendingMark: () => void; askDeleteBranch: () => void };

const SCISSORS_CHARACTER = "✂";
const SCISSORS_MARK_CLASS = "scissorsMark";
const SCISSORS_EXCLUDED_CLASS = "scissorsExcluded";

function removeBarsCutStrip(): void {
    document.getElementById(BARS_CUT_STRIP_ID)?.remove();
}

function buildStripDiv(componentName: string, className: string): HTMLElement {
    return createElement("div", { class: className, "data-component": componentName });
}

function buildRowMarker(componentName: string, className: string, rowIndex: number, rowCount: number, text?: string): HTMLElement {
    const marker = createElement("div", { class: className, "data-component": componentName, text });
    marker.style.left = `${computeBarPercent(rowIndex, rowCount)}%`;
    return marker;
}

// A line from the newer row to the older row: left at the newer row, width up to the older row.
function buildRowLine(componentName: string, className: string, newerRowIndex: number, olderRowIndex: number, rowCount: number): HTMLElement {
    const newerPercent = computeBarPercent(newerRowIndex, rowCount);
    const line = buildStripDiv(componentName, className);
    line.style.left = `${newerPercent}%`;
    line.style.width = `${computeBarPercent(olderRowIndex, rowCount) - newerPercent}%`;
    return line;
}

function buildScissors(rowIndex: number, markRowIndex: number | undefined, rows: readonly RulerRow[]): HTMLElement {
    let className = "barsCutScissors";
    if (rowIndex === markRowIndex) {
        className += ` ${SCISSORS_MARK_CLASS}`;
    }
    if (markRowIndex !== undefined) {
        if (rowIndex < markRowIndex) {
            className += ` ${SCISSORS_EXCLUDED_CLASS}`;
        }
    }
    const scissors = createElement("span", {
        class: className,
        "data-component": "barsCutScissors",
        "data-row-index": String(rowIndex),
        title: rows[rowIndex]!.text,
        text: SCISSORS_CHARACTER,
        onclick: () => {
            scrollRealRulerRowIntoView(rowIndex);
            findRealRulerTickAtRowIndex(rowIndex).click();
        },
    });
    scissors.style.left = `${computeBarPercent(rowIndex, rows.length)}%`;
    return scissors;
}

function fillMiddleColumn(middleColumn: HTMLElement, rows: readonly RulerRow[]): void {
    const branch = readJfredBranch();
    const rowCount = rows.length;
    const placedEntries = listJfredEntries(branch).filter((entry) => entry.kind !== JfredEntryKind.pending);
    const baseEntry = placedEntries[0];
    const tipEntry = placedEntries.at(-1);
    let markRowIndex: number | undefined;
    if (branch.pending !== undefined) {
        markRowIndex = findRulerRowIndexForInstant(rows, branch.pending.instant);
    }
    if (baseEntry !== undefined && tipEntry !== undefined) {
        const baseRowIndex = findRulerRowIndexForInstant(rows, baseEntry.instant);
        const tipRowIndex = findRulerRowIndexForInstant(rows, tipEntry.instant);
        middleColumn.append(buildRowLine("barsCutBranchLine", "barsCutBranchLine", tipRowIndex, baseRowIndex, rowCount));
        for (const entry of placedEntries) {
            middleColumn.append(buildRowMarker("barsCutCap", "barsCutCap", findRulerRowIndexForInstant(rows, entry.instant), rowCount));
        }
        middleColumn.append(buildRowMarker("barsCutHashLabel", "barsCutHashLabel", baseRowIndex, rowCount, baseEntry.shortHash));
        if (tipEntry !== baseEntry) {
            middleColumn.append(buildRowMarker("barsCutHashLabel", "barsCutHashLabel", tipRowIndex, rowCount, tipEntry.shortHash));
        }
        if (markRowIndex !== undefined) {
            middleColumn.append(buildRowLine("barsCutDottedLine", "barsCutDottedLine", markRowIndex, tipRowIndex, rowCount));
        }
    }
    for (const rowIndex of listBarsMarkableRowIndexes(readTipMs())) {
        middleColumn.append(buildScissors(rowIndex, markRowIndex, rows));
    }
}

function buildLeftColumn(handlers: BarsCutStripHandlers): HTMLElement {
    const leftColumn = buildStripDiv("barsCutStripLeft", "barsColLeft barsCutStripLeft");
    leftColumn.append(createElement("span", {
        class: "barsCutDeleteBranch",
        "data-component": "barsCutDeleteBranch",
        text: "Delete jfred branch",
        onclick: handlers.askDeleteBranch,
    }));
    return leftColumn;
}

function buildRightColumn(handlers: BarsCutStripHandlers): HTMLElement {
    const rightColumn = buildStripDiv("barsCutStripRight", "barsColRight barsCutStripRight");
    rightColumn.append(createElement("span", { class: "barsCutBranchLabel", "data-component": "barsCutBranchLabel", text: "jfred branch" }));
    if (readJfredBranch().pending !== undefined) {
        rightColumn.append(createElement("button", {
            id: "barsCutCommitButton",
            class: "barsCutCommitButton",
            "data-component": "barsCutCommitButton",
            text: "Commit",
            onclick: handlers.commitPendingMark,
        }));
    } else {
        rightColumn.append(createElement("span", { class: "barsCutHint", "data-component": "barsCutHint", text: "click scissors to mark" }));
    }
    return rightColumn;
}

// Draws or removes #barsCutStrip. The real ruler rows are read at each draw and kept nowhere (section 3.4).
export function renderBarsCutStrip(handlers: BarsCutStripHandlers): void {
    if (!isBarsViewOn()) {
        removeBarsCutStrip();
        return;
    }
    if (!readJfredBranch().isArmed) {
        removeBarsCutStrip();
        return;
    }
    const stickyHeader = getRequiredElementById("barsStickyHeader");
    let strip = document.getElementById(BARS_CUT_STRIP_ID);
    if (strip === null) {
        strip = createElement("div", { id: BARS_CUT_STRIP_ID, class: "barsCutStrip", "data-component": "barsCutStrip" });
    }
    stickyHeader.append(strip);
    const middleColumn = buildStripDiv("barsCutStripMiddle", "barsColMid barsCutStripMiddle");
    const rows = listRealRulerRows();
    if (rows.length > 0) {
        if (!getBarsViewState().isHistoryLoading) {
            fillMiddleColumn(middleColumn, rows);
        }
    }
    strip.replaceChildren(buildLeftColumn(handlers), middleColumn, buildRightColumn(handlers));
}

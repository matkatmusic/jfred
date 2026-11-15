import { createElement, getRequiredElementById } from "../../app-dom.ts";
import { buildBarsArrowElement } from "./layer1-bars-header.ts";
import { computeFillPercent, describeFinalState, describeFoldedState, isBarFileChangedSince } from "./layer1-bars-model.ts";
import { buildModelBarRow, setBarRowFillPercent, type BarRowElements } from "./layer1-bars-row.ts";
import type { BarsViewState } from "./layer1-bars-state.ts";

function setFoldShown(foldToggleElement: HTMLElement, foldedListElement: HTMLElement, isFoldShown: boolean): void {
    foldToggleElement.textContent = isFoldShown ? "[hide]" : "[show]";
    foldedListElement.style.display = isFoldShown ? "block" : "none";
}

function buildFoldLine(foldedFileCount: number, foldToggleElement: HTMLElement): HTMLElement {
    const arrowElement = buildBarsArrowElement();
    return createElement("div", { class: "barsFoldLine", "data-component": "barsFoldLine" }, [arrowElement, ` ${foldedFileCount} files with no change since this row `, foldToggleElement]);
}

function readLayoutWidth(element: HTMLElement): number {
    return element.offsetWidth;
}

// Fills #barsRowList from state.models and state.selectedRowIndex. Writes state.rowElements. Sets --bars-slot-width on #barsRows.
export function renderBarsRowList(state: BarsViewState, isPlaceholder: boolean): void {
    const rowListElement = getRequiredElementById("barsRowList");
    const rowsElement = getRequiredElementById("barsRows");
    const foldToggleElement = createElement("span", { class: "barsFoldToggle", "data-component": "barsFoldToggle" });
    const foldedListElement = createElement("div", { class: "barsFoldedList", "data-component": "barsFoldedList" });
    const changedRows: { row: BarRowElements; fillPercent: number }[] = [];
    let foldedFileCount = 0;
    rowListElement.replaceChildren();
    state.rowElements = [];
    for (const [fileIndex, model] of state.models.entries()) {
        const isFolded = !isBarFileChangedSince(model, state.selectedRowIndex);
        const rightText = isFolded ? describeFoldedState(model, state.selectedRowIndex) : describeFinalState(model, state.selectedRowIndex);
        const row = buildModelBarRow(model, fileIndex, state.rulerRows, { selectedRowIndex: state.selectedRowIndex, isPlaceholder, isFolded, rightText });
        state.rowElements[fileIndex] = row;
        if (isFolded) {
            foldedListElement.append(row.rowElement);
            foldedFileCount++;
        } else {
            rowListElement.append(row.rowElement);
            changedRows.push({ row, fillPercent: computeFillPercent(model, Math.min(state.selectedRowIndex, model.bornRowIndex)) });
        }
    }
    if (foldedFileCount > 0) {
        setFoldShown(foldToggleElement, foldedListElement, state.isFoldShown);
        rowListElement.append(buildFoldLine(foldedFileCount, foldToggleElement), foldedListElement);
    }
    readLayoutWidth(rowListElement);
    for (const changedRow of changedRows) {
        setBarRowFillPercent(changedRow.row, changedRow.fillPercent);
    }
    rowsElement.style.setProperty("--bars-slot-width", 100 / Math.max(state.rulerRows.length - 1, 1) + "%");
}

// Flips state.isFoldShown and updates the toggle text and the folded list display.
export function toggleBarsFold(state: BarsViewState): void {
    const rowListElement = getRequiredElementById("barsRowList");
    const foldToggleElement = rowListElement.querySelector<HTMLElement>(".barsFoldToggle");
    const foldedListElement = rowListElement.querySelector<HTMLElement>(".barsFoldedList");
    if (foldToggleElement === null) {
        throw new Error("toggleBarsFold: the row list has no fold line");
    }
    if (foldedListElement === null) {
        throw new Error("toggleBarsFold: the row list has no folded list");
    }
    state.isFoldShown = !state.isFoldShown;
    setFoldShown(foldToggleElement, foldedListElement, state.isFoldShown);
}

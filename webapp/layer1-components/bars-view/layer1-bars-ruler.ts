import { getRequiredElementById } from "../../app-dom.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";
import { rowsByTick } from "../ruler/layer1-tick-events.ts";

export const BARS_SELECTED_TICK_CLASS = "barsSelected";
export const BARS_RULER_LOADING_CLASS = "barsRulerLoading";

function listRealRulerTicks(): HTMLElement[] {
    const ticksOldestFirst = Array.from(getRequiredElementById("timelineRulerComponent").querySelectorAll<HTMLElement>(".tick"));
    return ticksOldestFirst.reverse();
}

// The tick of the real ruler at rowIndex (newest first). No tick at the index throws. Commit strip scissors click it (tick.click()).
export function findRealRulerTickAtRowIndex(rowIndex: number): HTMLElement {
    const tick = listRealRulerTicks()[rowIndex];
    if (tick === undefined) {
        throw new Error(`ruler has no tick at row index ${rowIndex}`);
    }
    return tick;
}

// The rows of the REAL ruler: every .tick of #timelineRulerComponent, newest first (the DOM order is oldest first, so the list is reversed). Each row is rowsByTick.get(tick) (ruler/layer1-tick-events.ts). A tick with no stored row throws.
export function listRealRulerRows(): RulerRow[] {
    const rows: RulerRow[] = [];
    for (const tick of listRealRulerTicks()) {
        const row = rowsByTick.get(tick);
        if (row === undefined) {
            throw new Error("ruler tick has no stored row");
        }
        rows.push(row);
    }
    return rows;
}
// Index of one real tick in that same newest-first order. A tick that is not a .tick of #timelineRulerComponent throws.
export function findRealRulerTickRowIndex(tick: HTMLElement): number {
    const rowIndex = listRealRulerTicks().indexOf(tick);
    if (rowIndex === -1) {
        throw new Error("tick is not a .tick of #timelineRulerComponent");
    }
    return rowIndex;
}
// The rule "Which ruler row holds a time" in section 2. rows is newest first.
export function findRulerRowIndexForInstant(rows: readonly RulerRow[], instant: string | null): number {
    if (rows.length === 0) {
        throw new Error("ruler has no rows");
    }
    if (instant === null) {
        return 0;
    }
    const instantTime = Date.parse(instant);
    let oldestMatchingRowIndex = 0;
    let isOldestMatchFound = false;
    for (const [rowIndex, row] of rows.entries()) {
        const newestRowInstant = row.instants[row.instants.length - 1];
        if (newestRowInstant === undefined) {
            throw new Error(`ruler row ${rowIndex} has no instants`);
        }
        const newestRowTime = Date.parse(newestRowInstant);
        if (newestRowTime >= instantTime) {
            oldestMatchingRowIndex = rowIndex;
            isOldestMatchFound = true;
        }
    }
    if (isOldestMatchFound) {
        return oldestMatchingRowIndex;
    }
    return 0;
}
// rowIndex / (rowCount - 1) * 100. When rowCount is 1 it returns 0.
export function computeBarPercent(rowIndex: number, rowCount: number): number {
    if (rowCount === 1) {
        return 0;
    }
    return (rowIndex / (rowCount - 1)) * 100;
}
// Removes barsSelected from every real tick, then adds it to the tick at rowIndex (newest first). An index with no tick throws.
export function markRealRulerRowSelected(rowIndex: number): void {
    const tickToSelect = findRealRulerTickAtRowIndex(rowIndex);
    for (const tick of listRealRulerTicks()) {
        tick.classList.remove(BARS_SELECTED_TICK_CLASS);
    }
    tickToSelect.classList.add(BARS_SELECTED_TICK_CLASS);
}
// scrollIntoView({ block: "center" }) on the real tick at rowIndex.
export function scrollRealRulerRowIntoView(rowIndex: number): void {
    findRealRulerTickAtRowIndex(rowIndex).scrollIntoView({ block: "center" });
}
// Adds BARS_RULER_LOADING_CLASS to #timelineRulerComponent when isLoading is true, removes it when false. The CSS (S10) makes the ticks ignore clicks only in Bars view.
export function setRealRulerLoading(isLoading: boolean): void {
    getRequiredElementById("timelineRulerComponent").classList.toggle(BARS_RULER_LOADING_CLASS, isLoading);
}

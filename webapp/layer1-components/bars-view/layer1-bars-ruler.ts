import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";

export const BARS_SELECTED_TICK_CLASS = "barsSelected";
export const BARS_RULER_LOADING_CLASS = "barsRulerLoading";

// The rows of the REAL ruler: every .tick of #timelineRulerComponent, newest first (the DOM order is oldest first, so the list is reversed). Each row is rowsByTick.get(tick) (ruler/layer1-tick-events.ts). A tick with no stored row throws.
export function listRealRulerRows(): RulerRow[] {
    throw new Error("not built: listRealRulerRows");
}
// Index of one real tick in that same newest-first order. A tick that is not a .tick of #timelineRulerComponent throws.
export function findRealRulerTickRowIndex(tick: HTMLElement): number {
    throw new Error("not built: findRealRulerTickRowIndex");
}
// The rule "Which ruler row holds a time" in section 2. rows is newest first.
export function findRulerRowIndexForInstant(rows: readonly RulerRow[], instant: string | null): number {
    throw new Error("not built: findRulerRowIndexForInstant");
}
// rowIndex / (rowCount - 1) * 100. When rowCount is 1 it returns 0.
export function computeBarPercent(rowIndex: number, rowCount: number): number {
    throw new Error("not built: computeBarPercent");
}
// Removes barsSelected from every real tick, then adds it to the tick at rowIndex (newest first). An index with no tick throws.
export function markRealRulerRowSelected(rowIndex: number): void {
    throw new Error("not built: markRealRulerRowSelected");
}
// scrollIntoView({ block: "center" }) on the real tick at rowIndex.
export function scrollRealRulerRowIntoView(rowIndex: number): void {
    throw new Error("not built: scrollRealRulerRowIntoView");
}
// Adds BARS_RULER_LOADING_CLASS to #timelineRulerComponent when isLoading is true, removes it when false. The CSS (S10) makes the ticks ignore clicks only in Bars view.
export function setRealRulerLoading(isLoading: boolean): void {
    throw new Error("not built: setRealRulerLoading");
}

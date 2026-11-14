import type { BarsViewState } from "./layer1-bars-state.ts";
// Job 1. After the staged reveal the chunks stay shown, state.isHistoryLoading is false and the real ruler rows are clickable again. No callback: nothing runs at the end except the header line.
export function loadBarsHistory(
    state: BarsViewState,
    sourceParams: URLSearchParams,
    waitMilliseconds?: (milliseconds: number) => Promise<void>,
): Promise<void> {
    throw new Error("not built: loadBarsHistory");
}

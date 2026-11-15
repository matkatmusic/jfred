import type { BarFileModel } from "./layer1-bars-model.ts";
import type { BarRowElements } from "./layer1-bars-row.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";

export type BarsViewState = {
    runId: number;
    isLoadNeeded: boolean;
    isHistoryLoading: boolean;
    isFoldShown: boolean;
    isEventsInBar: boolean;
    projectDir: string;
    rulerRows: RulerRow[];             // the rows of the real ruler, newest first, read at the result line by listRealRulerRows()
    models: BarFileModel[];
    rowElements: BarRowElements[];     // parallel to models; written by renderBarsRowList
    selectedRowIndex: number;          // index into rulerRows. The real ruler holds no selected row of its own, so the Bars view keeps this one.
    selectedDotElement: HTMLElement | undefined;
    isRulerRefreshNeeded: boolean;     // true when the real ruler was drawn again while Bars view was off; S13 reads the rows again at the next mode change
};

export function createBarsViewState(): BarsViewState {
    return {
        runId: 0,
        isLoadNeeded: false,
        isHistoryLoading: false,
        isFoldShown: true,
        isEventsInBar: false,
        projectDir: "",
        rulerRows: [],
        models: [],
        rowElements: [],
        selectedRowIndex: 0,
        selectedDotElement: undefined,
        isRulerRefreshNeeded: false,
    };
}

let barsViewState: BarsViewState | undefined;

export function getBarsViewState(): BarsViewState {
    if (barsViewState === undefined) {
        barsViewState = createBarsViewState();
    }
    return barsViewState;
}

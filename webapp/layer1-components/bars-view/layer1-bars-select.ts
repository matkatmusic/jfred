import { getRequiredElementById } from "../../app-dom.ts";
import { BARS_READ_FROM_REPOS_TEXT, describeSelectedHeader, setBarsHeaderLine, setBarsStatusLine, showBarsReadBar } from "./layer1-bars-header.ts";
import { markRealRulerRowSelected } from "./layer1-bars-ruler.ts";
import { renderBarsRowList } from "./layer1-bars-rowlist.ts";
import type { BarsViewState } from "./layer1-bars-state.ts";

// Job 2. Does nothing while state.isHistoryLoading (the real ruler rows are disabled then; this stops a shift-click on a dot). The first call hides the chunks. rowIndex counts from the newest row of the real ruler. See the file section.
export function selectBarsRow(state: BarsViewState, rowIndex: number): void {
    if (state.isHistoryLoading) {
        return;
    }
    state.selectedRowIndex = rowIndex;
    markRealRulerRowSelected(rowIndex);
    getRequiredElementById("barsRows").setAttribute("data-blocks", "hidden");
    state.selectedDotElement = undefined;
    renderBarsRowList(state, false);
    const selectedRulerRow = state.rulerRows[rowIndex];
    if (selectedRulerRow === undefined) {
        throw new Error(`no ruler row at index ${rowIndex}`);
    }
    setBarsHeaderLine(describeSelectedHeader(state.models.length, selectedRulerRow.text));
    setBarsStatusLine(BARS_READ_FROM_REPOS_TEXT);
    showBarsReadBar(false);
}

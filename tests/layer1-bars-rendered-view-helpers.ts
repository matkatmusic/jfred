import { renderBarsCutStrip, type BarsCutStripHandlers } from "../webapp/layer1-components/bars-view/layer1-bars-cut-strip.ts";
import { BarsViewMode, setBarsViewMode } from "../webapp/layer1-components/bars-view/layer1-bars-mode.ts";
import { BarMarkKind, type BarDotModel, type BarFileModel } from "../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { listRealRulerRows } from "../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { renderBarsRowList } from "../webapp/layer1-components/bars-view/layer1-bars-rowlist.ts";
import { getBarsViewState } from "../webapp/layer1-components/bars-view/layer1-bars-state.ts";
import { BarDotKind } from "../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
import { appendCommit, deleteJfredBranch, setArmed, setBase, setPending } from "../webapp/layer1-components/commits-column/layer1-jfred-state.ts";
import type { RulerRow } from "../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import { storeRow } from "../webapp/layer1-components/ruler/layer1-tick-events.ts";
import { ShowRowKind } from "../webapp/layer1-components/show-row/layer1-show-row.ts";
import { buildInverseCommit, initBarsDom } from "./layer1-bars-test-helpers.ts";

const DAY_START_MS = Date.parse("2026-11-13T00:00:00.000Z");
const HOUR_MS = 3600_000;
const NO_HANDLERS: BarsCutStripHandlers = { commitPendingMark: () => {}, askDeleteBranch: () => {} };

function buildInstant(hour: number): string {
    return new Date(DAY_START_MS + hour * HOUR_MS).toISOString();
}

function buildRow(hours: number[]): RulerRow {
    const instants = hours.map(buildInstant);
    return { axisPx: 0, text: "r", eventCount: instants.length, axisPxList: instants.map(() => 0), instants };
}

function fillRulerWithRows(rowsNewestFirst: number[][]): void {
    const ruler = document.getElementById("timelineRulerComponent")!;
    ruler.replaceChildren();
    for (const hours of [...rowsNewestFirst].reverse()) {
        const tick = document.createElement("div");
        tick.className = "tick";
        ruler.appendChild(tick);
        storeRow(tick, buildRow(hours));
    }
}

function buildDot(overrides: Partial<BarDotModel>): BarDotModel {
    return {
        commitIndex: 0,
        commitHash: "c0",
        rowIndex: 0,
        kind: BarDotKind.commit,
        group: ShowRowKind.commit,
        stageIndex: 1,
        alpha: 1,
        instant: null,
        ...overrides,
    };
}

function buildModel(overrides: Partial<BarFileModel>): BarFileModel {
    return {
        path: "src/a.ts",
        startRowIndex: 0,
        goneMarkKind: undefined,
        bornRowIndex: 4,
        isPlusShown: false,
        commits: [buildInverseCommit()],
        dots: [],
        changes: [],
        marks: [],
        ...overrides,
    };
}

// changed.ts changed at row 0 (above selected row 1), shows a plus, a removed mark and a moved-away mark. same.ts has no change, so it is folded.
function buildChangedAndUnchangedModels(): BarFileModel[] {
    const changeDot = buildDot({ rowIndex: 0 });
    const changedModel = buildModel({
        path: "changed.ts",
        isPlusShown: true,
        dots: [changeDot],
        changes: [changeDot],
        marks: [
            { kind: BarMarkKind.removed, rowIndex: 2, movedAwayTo: null },
            { kind: BarMarkKind.movedAway, rowIndex: 3, movedAwayTo: "moved.ts" },
        ],
    });
    const unchangedModel = buildModel({ path: "same.ts" });
    return [changedModel, unchangedModel];
}

// Rows: h12 h10 h8 h6 h4, selected row 1. Cut strip: base at h4, tip at h8, pending mark at h10, so the dotted line, caps, both hash labels and the commit button render.
export function renderBarsRowsAndCutStrip(): void {
    initBarsDom();
    const appWindow = document.createElement("div");
    appWindow.id = "appWindow";
    document.body.appendChild(appWindow);
    const ruler = document.createElement("div");
    ruler.id = "timelineRulerComponent";
    document.body.appendChild(ruler);
    fillRulerWithRows([[12], [10], [8], [6], [4]]);

    const state = getBarsViewState();
    state.isHistoryLoading = false;
    state.rulerRows = listRealRulerRows();
    state.selectedRowIndex = 1;
    state.models = buildChangedAndUnchangedModels();
    renderBarsRowList(state, false);

    deleteJfredBranch();
    setBase({ instant: buildInstant(4), shortHash: "base0001" });
    appendCommit({ instant: buildInstant(8), shortHash: "tip00001", parentShortHash: "base0001", message: "first" });
    setPending({ instant: buildInstant(10), message: "m" });
    setArmed(true);
    setBarsViewMode(BarsViewMode.bars);
    renderBarsCutStrip(NO_HANDLERS);
}

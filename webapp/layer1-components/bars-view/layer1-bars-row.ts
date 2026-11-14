import type { BarFileModel } from "./layer1-bars-model.ts";
import type { RulerRow } from "../ruler/layer1-ruler-rows.ts";

export const BarRowMark = { waiting: "waiting", running: "running", done: "done" } as const;
export type BarRowMark = (typeof BarRowMark)[keyof typeof BarRowMark];
export type BarRowElements = {
    rowElement: HTMLElement;
    markElement: HTMLElement;
    pathElement: HTMLElement;
    progressBarElement: HTMLElement;   // the FileReconstructionProgressBar
    fillElement: HTMLElement;
    targetElement: HTMLElement | undefined;   // undefined on a stream row
    rightElement: HTMLElement;
};
export type BarModelRowOptions = { selectedRowIndex: number; isPlaceholder: boolean; isFolded: boolean; rightText: string };

// Row for a file seen only in the stream: mark waiting, path, a full-width bar, fill 0, right text "waiting". No dots, no chunks, no target.
export function buildStreamBarRow(path: string): BarRowElements {
    throw new Error("not built: buildStreamBarRow");
}
// Full row of the mockup (buildFileRow): see the file section. fileIndex goes to data-file-index on the path and on every dot.
export function buildModelBarRow(model: BarFileModel, fileIndex: number, rulerRows: readonly RulerRow[], options: BarModelRowOptions): BarRowElements {
    throw new Error("not built: buildModelBarRow");
}
export function setBarRowMark(row: BarRowElements, mark: BarRowMark): void {
    throw new Error("not built: setBarRowMark");
}
export function setBarRowFillPercent(row: BarRowElements, percent: number): void {   // fillElement.style.width = percent + "%"
    throw new Error("not built: setBarRowFillPercent");
}
export function setBarRowRightText(row: BarRowElements, text: string): void {
    throw new Error("not built: setBarRowRightText");
}
// In rowListElement: every [data-stage-index="<stageIndex>"] element loses dotPlaceholder (dots) and gains blockRevealed (chunks).
export function revealBarsHistoryStage(rowListElement: HTMLElement, stageIndex: number): void {
    throw new Error("not built: revealBarsHistoryStage");
}

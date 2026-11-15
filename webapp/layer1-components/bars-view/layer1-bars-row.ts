import { createElement } from "../../app-dom.ts";
import { BarMarkKind, type BarDotModel, type BarFileModel, type BarMarkModel } from "./layer1-bars-model.ts";
import { computeBarPercent } from "./layer1-bars-ruler.ts";
import { BAR_DOT_LABELS } from "./layer1-bars-wire.ts";
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

function buildDiv(className: string, extraAttributes: Record<string, string> = {}): HTMLElement {
    const firstClassName = className.split(" ")[0] as string;
    return createElement("div", { class: className, "data-component": firstClassName, ...extraAttributes });
}

function buildMarkElement(mark: BarRowMark): HTMLElement {
    return buildDiv("barsMark " + mark);
}

function buildPathElement(path: string, fileIndex: number | undefined): HTMLElement {
    const pathElement = buildDiv("barsFilePath");
    pathElement.textContent = path;
    pathElement.title = path;
    if (fileIndex !== undefined) {
        pathElement.dataset.fileIndex = String(fileIndex);
    }
    return pathElement;
}

function formatRowText(rulerRows: readonly RulerRow[], rowIndex: number): string {
    const rulerRow = rulerRows[rowIndex];
    if (rulerRow === undefined) {
        throw new Error(`ruler has no row ${rowIndex}`);
    }
    return rulerRow.text;
}

function buildBarDot(dot: BarDotModel, fileIndex: number, dotIndex: number, rulerRows: readonly RulerRow[], isPlaceholder: boolean): HTMLElement {
    let className = `BarDot bd-${dot.kind} grp-${dot.group}`;
    if (isPlaceholder) {
        className += " dotPlaceholder";
    }
    const dotElement = buildDiv(className);
    dotElement.style.left = computeBarPercent(dot.rowIndex, rulerRows.length) + "%";
    dotElement.title = BAR_DOT_LABELS[dot.kind] + "  " + formatRowText(rulerRows, dot.rowIndex);
    dotElement.dataset.fileIndex = String(fileIndex);
    dotElement.dataset.dotIndex = String(dotIndex);
    dotElement.dataset.stageIndex = String(dot.stageIndex);
    return dotElement;
}

function buildHistoryBlock(change: BarDotModel, model: BarFileModel, rulerRows: readonly RulerRow[]): HTMLElement {
    const barSpanRows = Math.max(model.bornRowIndex - model.startRowIndex, 1);
    const blockElement = buildDiv("barsHistoryBlock hb-" + change.kind);
    blockElement.style.left = ((change.rowIndex - model.startRowIndex) / barSpanRows) * 100 + "%";
    blockElement.style.width = 100 / barSpanRows + "%";
    blockElement.style.setProperty("--blockOpacity", String(change.alpha));
    blockElement.title = `${BAR_DOT_LABELS[change.kind]}  ${formatRowText(rulerRows, change.rowIndex)}  bytes known: ${Math.round(change.alpha * 100)}%`;
    blockElement.dataset.stageIndex = String(change.stageIndex);
    return blockElement;
}

function buildMarkSign(mark: BarMarkModel, rulerRows: readonly RulerRow[]): HTMLElement {
    const rowText = formatRowText(rulerRows, mark.rowIndex);
    let signElement: HTMLElement;
    if (mark.kind === BarMarkKind.removed) {
        signElement = buildDiv("barsMinusSign");
        signElement.textContent = "-";
        signElement.title = "removed  " + rowText;
    } else {
        signElement = buildDiv("barsMovedAwaySign");
        signElement.textContent = "←";
        signElement.title = `moved away to ${mark.movedAwayTo}  ${rowText}`;
    }
    signElement.style.left = computeBarPercent(mark.rowIndex, rulerRows.length) + "%";
    return signElement;
}

function buildPlusSign(model: BarFileModel, rowCount: number): HTMLElement {
    const plusSign = buildDiv("barsPlusSign");
    plusSign.textContent = "+";
    plusSign.style.left = computeBarPercent(model.bornRowIndex, rowCount) + "%";
    return plusSign;
}

// Row for a file seen only in the stream: mark waiting, path, a full-width bar, fill 0, right text "waiting". No dots, no chunks, no target.
export function buildStreamBarRow(path: string): BarRowElements {
    const markElement = buildMarkElement(BarRowMark.waiting);
    const pathElement = buildPathElement(path, undefined);
    const fillElement = buildDiv("barsFill");
    fillElement.style.width = "0%";
    const progressBarElement = buildDiv("FileReconstructionProgressBar");
    progressBarElement.style.left = "0%";
    progressBarElement.style.width = "100%";
    progressBarElement.append(fillElement);
    const lifetimeBar = buildDiv("ProjectLifetimeBar");
    lifetimeBar.append(progressBarElement);
    const rightElement = buildDiv("barsColRight");
    rightElement.textContent = "waiting";
    const leftColumn = buildDiv("barsColLeft");
    leftColumn.append(markElement, pathElement);
    const midColumn = buildDiv("barsColMid");
    midColumn.append(lifetimeBar);
    const rowElement = buildDiv("barsFileRow");
    rowElement.append(leftColumn, midColumn, rightElement);
    return { rowElement, markElement, pathElement, progressBarElement, fillElement, targetElement: undefined, rightElement };
}

// Full row of the mockup (buildFileRow): see the file section. fileIndex goes to data-file-index on the path and on every dot.
export function buildModelBarRow(model: BarFileModel, fileIndex: number, rulerRows: readonly RulerRow[], options: BarModelRowOptions): BarRowElements {
    const rowCount = rulerRows.length;
    const markElement = buildMarkElement(options.isFolded ? BarRowMark.waiting : BarRowMark.done);
    const pathElement = buildPathElement(model.path, fileIndex);
    const leftColumn = buildDiv("barsColLeft");
    leftColumn.append(markElement, pathElement);

    const startPercent = computeBarPercent(model.startRowIndex, rowCount);
    const progressBarElement = buildDiv("FileReconstructionProgressBar");
    progressBarElement.style.left = startPercent + "%";
    progressBarElement.style.width = computeBarPercent(model.bornRowIndex, rowCount) - startPercent + "%";
    const fillElement = buildDiv("barsFill");
    fillElement.style.width = "0%";
    progressBarElement.append(fillElement);
    for (const change of model.changes) {
        progressBarElement.append(buildHistoryBlock(change, model, rulerRows));
    }
    const lifetimeBar = buildDiv("ProjectLifetimeBar");
    lifetimeBar.append(progressBarElement);
    if (model.isPlusShown) {
        lifetimeBar.append(buildPlusSign(model, rowCount));
    }
    for (const mark of model.marks) {
        lifetimeBar.append(buildMarkSign(mark, rulerRows));
    }

    const dotStrip = buildDiv("barsDotStrip");
    for (const [dotIndex, dot] of model.dots.entries()) {
        dotStrip.append(buildBarDot(dot, fileIndex, dotIndex, rulerRows, options.isPlaceholder));
    }
    const targetElement = buildDiv("barsTargetSegment");
    targetElement.style.left = computeBarPercent(options.selectedRowIndex, rowCount) + "%";
    const midColumn = buildDiv("barsColMid");
    midColumn.append(lifetimeBar, dotStrip, targetElement);

    const rightElement = buildDiv("barsColRight");
    rightElement.textContent = options.rightText;
    const rowElement = buildDiv(options.isFolded ? "barsFileRow barsFoldedRow" : "barsFileRow");
    rowElement.append(leftColumn, midColumn, rightElement);
    return { rowElement, markElement, pathElement, progressBarElement, fillElement, targetElement, rightElement };
}

export function setBarRowMark(row: BarRowElements, mark: BarRowMark): void {
    row.markElement.className = "barsMark " + mark;
}
export function setBarRowFillPercent(row: BarRowElements, percent: number): void {   // fillElement.style.width = percent + "%"
    row.fillElement.style.width = percent + "%";
}
export function setBarRowRightText(row: BarRowElements, text: string): void {
    row.rightElement.textContent = text;
}
// In rowListElement: every [data-stage-index="<stageIndex>"] element loses dotPlaceholder (dots) and gains blockRevealed (chunks).
export function revealBarsHistoryStage(rowListElement: HTMLElement, stageIndex: number): void {
    const stageElements = rowListElement.querySelectorAll<HTMLElement>(`[data-stage-index="${stageIndex}"]`);
    for (const stageElement of stageElements) {
        stageElement.classList.remove("dotPlaceholder");
        if (stageElement.classList.contains("barsHistoryBlock")) {
            stageElement.classList.add("blockRevealed");
        }
    }
}

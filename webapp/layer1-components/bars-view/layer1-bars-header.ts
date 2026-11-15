import { createElement, getRequiredElementById } from "../../app-dom.ts";

export const BARS_READING_LOGS_TEXT = "Reading all session logs (one time)";
export const BARS_READ_FROM_REPOS_TEXT = "Read from the inverse repos";
export const BARS_NO_RULER_ROWS_TEXT = "No events to show in the ruler";

export function describeLoadingHeader(totalFiles: number | undefined): string {
    if (totalFiles === undefined) {
        return "Loading change history";
    }
    return `Loading change history for ${totalFiles} files`;
}

export function describeFilesDoneStatus(doneFiles: number, totalFiles: number): string {
    return `${doneFiles} of ${totalFiles} files done`;
}

export function describeSelectedHeader(fileCount: number, rowText: string): string {
    return `Change history of ${fileCount} files, back to ${rowText}`;
}

function writeArrowLine(lineId: string, text: string): void {
    const line = getRequiredElementById(lineId);
    const arrow = createElement("span", { class: "barsArrow", "data-component": "barsArrow", text: "==>" });
    line.replaceChildren(arrow, ` ${text}`);
}

export function setBarsHeaderLine(text: string): void {
    writeArrowLine("barsHeaderLine", text);
}

export function setBarsStatusLine(text: string): void {
    writeArrowLine("barsStatusLine", text);
}

export function showBarsReadBar(isShown: boolean): void {
    const readBar = getRequiredElementById("barsReadBar");
    readBar.toggleAttribute("hidden", !isShown);
}

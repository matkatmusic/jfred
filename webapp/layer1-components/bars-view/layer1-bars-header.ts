export const BARS_READING_LOGS_TEXT = "Reading all session logs (one time)";
export const BARS_READ_FROM_REPOS_TEXT = "Read from the inverse repos";
export function describeLoadingHeader(totalFiles: number | undefined): string {       // undefined: "Loading change history"; else "Loading change history for N files"
    throw new Error("not built: describeLoadingHeader");
}
export function describeFilesDoneStatus(doneFiles: number, totalFiles: number): string {   // "C of N files done"
    throw new Error("not built: describeFilesDoneStatus");
}
export function describeSelectedHeader(fileCount: number, rowText: string): string {  // "Change history of N files, back to <rowText>"
    throw new Error("not built: describeSelectedHeader");
}
export function setBarsHeaderLine(text: string): void {    // #barsHeaderLine = span.barsArrow "==>" + " " + text
    throw new Error("not built: setBarsHeaderLine");
}
export function setBarsStatusLine(text: string): void {    // #barsStatusLine, same shape
    throw new Error("not built: setBarsStatusLine");
}
export function showBarsReadBar(isShown: boolean): void { // toggles the hidden attribute of #barsReadBar
    throw new Error("not built: showBarsReadBar");
}

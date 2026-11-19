// The title of the View File box: the file name and the range of file lines on screen. A wrapped line counts once.

import type { FileViewLine } from "./engineV3_tui_file_view_text.ts";

// A continuation row of a wrapped line has no line number: the line it belongs to is the nearest numbered row above it.
function getFileLineNumberOfRow(rows: FileViewLine[], rowIndex: number): number {
    for (let searchIndex = rowIndex; searchIndex >= 0; searchIndex--) {
        const lineNumber = rows[searchIndex]!.lineNumber;
        if (lineNumber !== undefined) {
            return lineNumber;
        }
    }
    return 0;
}

export function describeFileViewTitle(fileName: string, rows: FileViewLine[], scrollTop: number, visibleRowCount: number): string {
    if (rows.length === 0) {
        return `${fileName} | showing 0-0 of 0 lines`;
    }
    const lastVisibleRowIndex = Math.min(scrollTop + visibleRowCount, rows.length) - 1;
    const firstLineNumber = getFileLineNumberOfRow(rows, scrollTop);
    const lastLineNumber = getFileLineNumberOfRow(rows, lastVisibleRowIndex);
    const totalLineNumber = getFileLineNumberOfRow(rows, rows.length - 1);
    return `${fileName} | showing ${firstLineNumber}-${lastLineNumber} of ${totalLineNumber} lines`;
}

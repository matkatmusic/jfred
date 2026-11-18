export const HEADER_ROWS = 1;

export interface VisibleRowRange {
    top: number;
    bottom: number;
}

export function getAvailableRowCount(terminalRows: number): number {
    return terminalRows - HEADER_ROWS - 2;
}

export function getVisibleRowRange(rowCount: number, cursorIndex: number, previousTop: number, availableHeight: number): VisibleRowRange {
    let top = previousTop;
    if (cursorIndex < previousTop) {
        top = cursorIndex;
    }
    if (cursorIndex >= previousTop + availableHeight) {
        top = cursorIndex - availableHeight + 1;
    }
    const largestTop = Math.max(0, rowCount - availableHeight);
    top = Math.min(Math.max(top, 0), largestTop);
    const bottom = Math.min(rowCount, top + availableHeight);
    return { top, bottom };
}

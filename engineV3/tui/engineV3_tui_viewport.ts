import type { Path } from "../../src/structures/domain.ts";
import type { SelectionState } from "./engineV3_tui_app_types.ts";
export const HEADER_ROWS = 1;

export interface VisibleRowRange {
    top: number;
    bottom: number;
}

export interface PageMoveInput {
    rowCount: number;
    cursorIndex: number;
    top: number;
    pageRowCount: number;
    direction: 1 | -1;
}
export interface PageMove {
    cursorIndex: number;
    top: number;
}
export function computePageMove({ rowCount, cursorIndex, top, pageRowCount, direction }: PageMoveInput): PageMove {
    const largestTop = Math.max(0, rowCount - pageRowCount);
    const pagedTop = Math.min(Math.max(top + direction * pageRowCount, 0), largestTop);
    const pagedCursorIndex = Math.min(Math.max(cursorIndex + direction * pageRowCount, 0), rowCount - 1);
    return { cursorIndex: pagedCursorIndex, top: pagedTop };
}
export interface PageMoveContext {
    previousTop: { current: number };
    selection: SelectionState;
    files: Path[];
    pageRowCount: number;
    direction: 1 | -1;
    setSelection: (selection: SelectionState) => void;
}
// Shift+Up and Shift+Down: the cursor and the first visible row move by one page together.
export function movePageInDirection(context: PageMoveContext): void {
    const { previousTop, selection, files, pageRowCount, direction, setSelection } = context;
    const move = computePageMove({ rowCount: files.length, cursorIndex: selection.cursorIndex, top: previousTop.current, pageRowCount, direction });
    previousTop.current = move.top;
    setSelection({ ...selection, cursorIndex: move.cursorIndex });
}
export function getAvailableRowCount(terminalRows: number, footerRowCount: number = 2): number {
    return terminalRows - HEADER_ROWS - footerRowCount;
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

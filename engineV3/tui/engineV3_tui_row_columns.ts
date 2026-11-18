// The column widths of one TUI file row: the same for every row, so the bars line up.

export const ROW_PREFIX_WIDTH = 3;
export const ROW_MARK_WIDTH = 1;
export const ROW_STATE_WIDTH = 24;
export const ROW_GAP_COUNT = 4;
const NAME_SHARE_OF_SCREEN = 0.3;

export type RowColumnWidths = { nameWidth: number; barWidth: number };

export function computeRowColumnWidths(terminalColumns: number, longestNameLength: number): RowColumnWidths {
    const nameWidth = Math.min(longestNameLength, Math.floor(terminalColumns * NAME_SHARE_OF_SCREEN));
    const barWidth = terminalColumns - ROW_PREFIX_WIDTH - nameWidth - ROW_MARK_WIDTH - ROW_STATE_WIDTH - ROW_GAP_COUNT;
    return { nameWidth, barWidth };
}

// Pure layout of the Marker Box row: which positions show, which sticky words show, and how many events are off screen.
// Position 0 is "now", positions 1..K are the K event times of one file, newest first, position K is the Earliest.

export const EVENT_TIME_TEXT_WIDTH = 19;
export const INNER_COLUMN_WIDTH = EVENT_TIME_TEXT_WIDTH + 2;
export const LEFT_STICKY_COLUMN_WIDTH = "(9999 newer events) <- Now".length;
export const RIGHT_STICKY_COLUMN_WIDTH = "Earlier -> (9999 older events)".length;
export const COLUMN_SEPARATOR = " | ";
// the border takes one column on each side, the padding one more on each side
export const BOX_SIDE_COLUMNS = 4;
const FIRST_WINDOW_START = 1;

export interface MarkerBoxLayout {
    windowStart: number;
    innerPositions: number[];
    newerCount: number;
    olderCount: number;
    leftShowsNow: boolean;
    rightShowsEarliest: boolean;
}

export function computeInnerColumnCount(boxColumns: number): number {
    const columnsForInnerColumns = boxColumns - BOX_SIDE_COLUMNS - LEFT_STICKY_COLUMN_WIDTH - RIGHT_STICKY_COLUMN_WIDTH - COLUMN_SEPARATOR.length;
    const innerColumnCount = Math.floor(columnsForInnerColumns / (INNER_COLUMN_WIDTH + COLUMN_SEPARATOR.length));
    return Math.max(1, innerColumnCount);
}

export function computeMarkerBoxLayout(eventCount: number, markedPosition: number, previousWindowStart: number | undefined, innerColumnCount: number): MarkerBoxLayout {
    // the marker sits in the sticky columns at 0 and K, so the window only has to hold positions 1..K-1
    const markedInnerPosition = Math.min(Math.max(markedPosition, FIRST_WINDOW_START), eventCount - 1);
    let windowStart = previousWindowStart ?? FIRST_WINDOW_START;
    if (markedInnerPosition < windowStart) {
        windowStart = markedInnerPosition;
    }
    if (markedInnerPosition >= windowStart + innerColumnCount) {
        windowStart = markedInnerPosition - innerColumnCount + 1;
    }
    const largestWindowStart = Math.max(FIRST_WINDOW_START, eventCount - innerColumnCount);
    windowStart = Math.min(Math.max(windowStart, FIRST_WINDOW_START), largestWindowStart);
    const lastInnerPosition = Math.min(windowStart + innerColumnCount - 1, eventCount - 1);
    const innerPositions: number[] = [];
    for (let position = windowStart; position <= lastInnerPosition; ++position) {
        innerPositions.push(position);
    }
    const rightShowsEarliest = lastInnerPosition >= eventCount - 1;
    const olderCount = rightShowsEarliest ? 0 : eventCount - lastInnerPosition;
    return {
        windowStart,
        innerPositions,
        newerCount: windowStart - FIRST_WINDOW_START,
        olderCount,
        leftShowsNow: windowStart === FIRST_WINDOW_START,
        rightShowsEarliest,
    };
}

export function formatNewerCountText(newerCount: number): string {
    return `(${newerCount} newer ${newerCount === 1 ? "event" : "events"})`;
}

export function formatOlderCountText(olderCount: number): string {
    return `(${olderCount} older ${olderCount === 1 ? "event" : "events"})`;
}

export function formatEventTimeText(instant: Date): string {
    const year = String(instant.getFullYear());
    const month = String(instant.getMonth() + 1).padStart(2, "0");
    const day = String(instant.getDate()).padStart(2, "0");
    const hours = String(instant.getHours()).padStart(2, "0");
    const minutes = String(instant.getMinutes()).padStart(2, "0");
    const seconds = String(instant.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

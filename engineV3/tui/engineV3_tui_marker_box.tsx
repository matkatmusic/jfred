// The Marker Box: one boxed row of event times with sticky "now" and "Earliest" columns and a [ ] marker.
import type { ReactNode } from "react";
// import { Box, Text } from "ink";
import { Text } from "ink";
import { TUI_COLORS } from "./engineV3_tui_colors.ts";
import { TitledBox } from "./engineV3_tui_titled_box.tsx";
import {
    COLUMN_SEPARATOR,
    LEFT_STICKY_COLUMN_WIDTH,
    RIGHT_STICKY_COLUMN_WIDTH,
    computeInnerColumnCount,
    computeMarkerBoxLayout,
    formatEventTimeText,
    formatNewerCountText,
    formatOlderCountText,
} from "./engineV3_tui_marker_box_layout.ts";

export const MARKER_BOX_ROW_COUNT = 3;
// const MARKER_BOX_BORDER_COLOR = "gray";
const MARKER_BOX_BORDER_COLOR = TUI_COLORS.markerBox.borderColor;

export interface MarkerBoxProps {
    eventInstants: Date[];
    markedPosition: number;
    windowStart: number;
    columns: number;
    markedColor: string;
    arrowColor: string;
    timeColor: string;
}

export function MarkerBox({ eventInstants, markedPosition, windowStart, columns, markedColor, arrowColor, timeColor }: MarkerBoxProps) {
    const eventCount = eventInstants.length;
    const layout = computeMarkerBoxLayout(eventCount, markedPosition, windowStart, computeInnerColumnCount(columns));
    const row: ReactNode[] = [];

    const newerCountText = formatNewerCountText(layout.newerCount);
    let leftWord = "<- Now";
    if (layout.leftShowsNow) {
        leftWord = "now";
    }
    let leftColor = arrowColor;
    if (markedPosition === 0) {
        leftWord = "[now]";
        leftColor = markedColor;
    }
    const leftPaddingWidth = LEFT_STICKY_COLUMN_WIDTH - newerCountText.length - 1 - leftWord.length;
    row.push(<Text key="left-padding">{" ".repeat(leftPaddingWidth)}</Text>);
    row.push(<Text key="left-count" color={arrowColor}>{`${newerCountText} `}</Text>);
    row.push(<Text key="left-word" color={leftColor}>{leftWord}</Text>);

    if (eventCount > 0) {
        row.push(<Text key="left-separator">{COLUMN_SEPARATOR}</Text>);
        for (const position of layout.innerPositions) {
            const timeText = formatEventTimeText(eventInstants[position - 1]!);
            let innerText = ` ${timeText} `;
            let innerColor = timeColor;
            if (position === markedPosition) {
                innerText = `[${timeText}]`;
                innerColor = markedColor;
            }
            row.push(<Text key={`position-${position}`} color={innerColor}>{innerText}</Text>);
            row.push(<Text key={`separator-${position}`}>{COLUMN_SEPARATOR}</Text>);
        }

        let rightWord = "Earlier ->";
        if (layout.rightShowsEarliest) {
            rightWord = "Earliest";
        }
        let rightColor = arrowColor;
        if (markedPosition === eventCount) {
            rightWord = "[Earliest]";
            rightColor = markedColor;
        }
        const olderCountText = formatOlderCountText(layout.olderCount);
        const rightPaddingWidth = RIGHT_STICKY_COLUMN_WIDTH - rightWord.length - 1 - olderCountText.length;
        row.push(<Text key="right-word" color={rightColor}>{rightWord}</Text>);
        row.push(<Text key="right-count" color={arrowColor}>{` ${olderCountText}`}</Text>);
        row.push(<Text key="right-padding">{" ".repeat(rightPaddingWidth)}</Text>);
    }

    return (
        // <Box borderStyle="round" borderColor={MARKER_BOX_BORDER_COLOR} paddingX={1} width={columns}>
        <TitledBox title="Marker" borderColor={MARKER_BOX_BORDER_COLOR} paddingX={1} columns={columns}>
            <Text wrap="truncate-end">{row}</Text>
        </TitledBox>
    );
}

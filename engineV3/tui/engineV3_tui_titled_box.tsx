// A round box with its title centered in the top border. Ink has no border title, so the top border is one Text line.

import type { ReactNode } from "react";
import { Box, Text } from "ink";

const TITLE_BORDER_ROWS = 1;
const CORNER_COLUMNS = 2;

export type TitledBoxProps = {
    title: string;
    columns: number;
    borderColor?: string;
    height?: number;
    flexDirection?: "row" | "column";
    paddingX?: number;
    children?: ReactNode;
};

export function buildTopBorderText(title: string, columns: number): string {
    const titleField = ` ${title} `;
    const dashCount = columns - CORNER_COLUMNS - titleField.length;
    const leftDashCount = Math.floor(dashCount / 2);
    return `╭${"─".repeat(leftDashCount)}${titleField}${"─".repeat(dashCount - leftDashCount)}╮`;
}

export function TitledBox({ title, columns, borderColor, height, flexDirection, paddingX, children }: TitledBoxProps) {
    const contentHeight = height === undefined ? undefined : height - TITLE_BORDER_ROWS;
    return (
        <Box flexDirection="column" width={columns} height={height}>
            <Text color={borderColor}>{buildTopBorderText(title, columns)}</Text>
            <Box flexDirection={flexDirection} borderStyle="round" borderTop={false} borderColor={borderColor} paddingX={paddingX} width={columns} height={contentHeight}>{children}</Box>
        </Box>
    );
}

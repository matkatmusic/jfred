// The Engine Console box: draws the engine log lines from a scroll position inside a round border.

// import { Box, Text } from "ink";
import { Text } from "ink";
import { EngineLogLineKind, type EngineLogLine } from "./engineV3_tui_engine_log.ts";
import { TitledBox } from "./engineV3_tui_titled_box.tsx";

const BORDER_ROWS = 2;

export type ConsoleBoxProps = { lines: EngineLogLine[]; scrollTop: number; rowCount: number; columns: number; summaryColor: string; rawColor: string };

export function clampConsoleScrollTop(scrollTop: number, lineCount: number, visibleLineCount: number): number {
    const largestScrollTop = Math.max(0, lineCount - visibleLineCount);
    return Math.min(Math.max(scrollTop, 0), largestScrollTop);
}

export function ConsoleBox({ lines, scrollTop, rowCount, columns, summaryColor, rawColor }: ConsoleBoxProps) {
    const visibleLines = lines.slice(scrollTop, scrollTop + rowCount - BORDER_ROWS);
    return (
        // <Box flexDirection="column" borderStyle="round" width={columns} height={rowCount}>
        <TitledBox title="Engine Console" flexDirection="column" columns={columns} height={rowCount}>
            {visibleLines.map((line, index) => (
                <Text key={scrollTop + index} wrap="truncate-end" color={line.kind === EngineLogLineKind.Summary ? summaryColor : rawColor}>{line.text}</Text>
            ))}
        </TitledBox>
    );
}

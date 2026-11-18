// The loading screen: the legend, the progress line with the barbershop, and the Engine Console filling the rest of the window.

import { Box, Text } from "ink";
import { Barbershop } from "./engineV3_tui_barbershop.tsx";
import { TUI_COLORS } from "./engineV3_tui_colors.ts";
import { ConsoleBox, clampConsoleScrollTop } from "./engineV3_tui_console_box.tsx";
import type { EngineLog } from "./engineV3_tui_engine_log.ts";
import { LEGEND_ROW_COUNT, LegendFrame } from "./engineV3_tui_legend_frame.tsx";
import { useTerminalSize, type TerminalSize } from "./engineV3_tui_terminal_size.ts";

export const BARBERSHOP_WIDTH = 30;
const PROGRESS_ROW_COUNT = 1;
const CONSOLE_BORDER_ROWS = 2;

export type LoadingScreenProps = { progressText: string; engineLog: EngineLog; startSize: TerminalSize };

export function LoadingScreen({ progressText, engineLog, startSize }: LoadingScreenProps) {
    const { terminalRows, terminalColumns } = useTerminalSize(startSize);
    const lines = engineLog.listLines();
    const consoleRowCount = terminalRows - LEGEND_ROW_COUNT - PROGRESS_ROW_COUNT;
    const scrollTop = clampConsoleScrollTop(lines.length, lines.length, consoleRowCount - CONSOLE_BORDER_ROWS);
    return (
        <LegendFrame>
            <Box gap={1}>
                <Text>{progressText}</Text>
                <Barbershop width={BARBERSHOP_WIDTH} />
            </Box>
            <ConsoleBox lines={lines} scrollTop={scrollTop} rowCount={consoleRowCount} columns={terminalColumns} summaryColor={TUI_COLORS.consoleBox.summaryColor} rawColor={TUI_COLORS.consoleBox.rawColor} />
        </LegendFrame>
    );
}

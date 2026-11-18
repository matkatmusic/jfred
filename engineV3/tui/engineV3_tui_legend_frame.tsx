// A frame that keeps the legend box at the top of every TUI screen, with the screen content under it.

import type { ReactNode } from "react";
import { Box, useStdout } from "ink";
import { LegendBox, countLinesBoxRows } from "./engineV3_tui_footer.tsx";
import { buildBarLegendLines } from "./engineV3_tui_legend.ts";

export const LEGEND_ROW_COUNT = countLinesBoxRows(buildBarLegendLines());

export function LegendFrame({ children }: { children: ReactNode }) {
    const { stdout } = useStdout();
    return (
        <Box flexDirection="column">
            <LegendBox lines={buildBarLegendLines()} columns={stdout.columns} />
            {children}
        </Box>
    );
}

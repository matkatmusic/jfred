// The box colors of the terminal UI: they come from the color boxes of keymap.json.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BarDotKind } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";

export type TuiColors = {
    legendBox: { borderColor: string; defaultTextColor: string };
    infoBox: { borderColor: string; defaultKeyColor: string; valueColor: string };
    barRows: { undoneSoFarColor: string; dotColors: Record<BarDotKind, string> };
    markerBox: { borderColor: string; markedColor: string; arrowColor: string; timeColor: string };
    fileViewBox: { lineNumberColor: string; textColor: string; tokenColors: Record<string, string> };
    diffBox: { textColor: string; lineNumberColor: string; newerOnlyBackgroundColor: string; markerOnlyBackgroundColor: string };
    consoleBox: { summaryColor: string; rawColor: string };
};

export const TUI_COLORS: TuiColors = JSON.parse(readFileSync(join(import.meta.dirname, "keymap.json"), "utf8"));

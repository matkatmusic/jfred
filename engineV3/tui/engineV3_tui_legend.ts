// The legend lines that explain the symbols in the bars: bar parts, marks, dots.

import { BAR_DOT_LABELS, BarDotKind } from "../../webapp/layer1-components/bars-view/layer1-bars-wire.ts";
// import { DOT_COLORS } from "./engineV3_tui_row.tsx";
import { DOT_COLORS, UNDONE_SO_FAR_COLOR } from "./engineV3_tui_row.tsx";
import type { FooterEntry } from "./engineV3_tui_footer.tsx";

function buildDotEntries(): FooterEntry[] {
    const labelsByColor = new Map<string, string[]>();
    for (const kind of Object.values(BarDotKind)) {
        const color = DOT_COLORS[kind];
        labelsByColor.set(color, [...(labelsByColor.get(color) ?? []), BAR_DOT_LABELS[kind]]);
    }
    return [...labelsByColor].map(([color, labels]) => ({ label: "●", value: labels.join(" / "), labelColor: color }));
}

export function buildBarLegendLines(): FooterEntry[][] {
    return [
        [
            { label: "─", value: "the life of the file" },
            // { label: "█", value: "undone so far" },
            { label: "█", value: "undone so far", labelColor: UNDONE_SO_FAR_COLOR },
            { label: "│", value: "time marker" },
        ],
        [
            { label: "+", value: "file born here" },
            { label: "-", value: "file removed" },
            { label: "←", value: "file moved away" },
        ],
        buildDotEntries(),
    ];
}

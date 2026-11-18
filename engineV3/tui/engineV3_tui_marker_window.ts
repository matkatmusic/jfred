// The window start of the marker box: kept while the cursor file stays, forgotten when the cursor file changes.

import { useRef } from "react";
import type { Path } from "../../src/structures/domain.ts";
import { computeInnerColumnCount, computeMarkerBoxLayout } from "./engineV3_tui_marker_box_layout.ts";

type WindowMemory = { fileKey: string; windowStart: number };

export function useMarkerWindowStart(cursorFile: Path, eventCount: number, markedPosition: number, columns: number): number {
    const memory = useRef<WindowMemory | undefined>(undefined);
    let previousWindowStart: number | undefined = undefined;
    if (memory.current !== undefined) {
        if (memory.current.fileKey === cursorFile.value) {
            previousWindowStart = memory.current.windowStart;
        }
    }
    const layout = computeMarkerBoxLayout(eventCount, markedPosition, previousWindowStart, computeInnerColumnCount(columns));
    memory.current = { fileKey: cursorFile.value, windowStart: layout.windowStart };
    return layout.windowStart;
}

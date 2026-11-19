// The window start of the marker box: kept while the scope key stays (the cursor file, or the all files list), forgotten when it changes.

import { useRef } from "react";
import { computeInnerColumnCount, computeMarkerBoxLayout } from "./engineV3_tui_marker_box_layout.ts";

type WindowMemory = { fileKey: string; windowStart: number };

export function useMarkerWindowStart(scopeKey: string, eventCount: number, markedPosition: number, columns: number): number {
    const memory = useRef<WindowMemory | undefined>(undefined);
    let previousWindowStart: number | undefined = undefined;
    if (memory.current !== undefined) {
        if (memory.current.fileKey === scopeKey) {
            previousWindowStart = memory.current.windowStart;
        }
    }
    const layout = computeMarkerBoxLayout(eventCount, markedPosition, previousWindowStart, computeInnerColumnCount(columns));
    memory.current = { fileKey: scopeKey, windowStart: layout.windowStart };
    return layout.windowStart;
}

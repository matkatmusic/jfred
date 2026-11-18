// The View File state of the root component: open or closed, the lines of the file at its time, and the scroll position.

import { useMemo, useState } from "react";
import type { Path } from "../../src/structures/domain.ts";
import type { AppProps } from "./engineV3_tui_app_types.ts";
import { clampFileViewScrollTop, readFileTextAtInstant, type FileViewLine } from "./engineV3_tui_file_view_text.ts";
import { buildViewFileLines, canOpenViewFile, computeViewFileInstant } from "./engineV3_tui_view_file.ts";

export type ViewFileState = {
    isOpen: boolean;
    canOpen: boolean;
    lines: FileViewLine[];
    scrollTop: number;
    open: () => void;
    close: () => void;
    scroll: (lineCountDelta: number, visibleLineCount: number) => void;
};

// A new file or a new time resets the scroll position to 0.
export function useViewFile(props: AppProps, cursorFile: Path, fileTime: Date, nowTime: Date): ViewFileState {
    const [isOpen, setIsOpen] = useState(false);
    const [scrollState, setScrollState] = useState({ scrollKey: "", scrollTop: 0 });
    const scrollKey = `${cursorFile.value}|${fileTime.getTime()}`;
    const scrollTop = scrollState.scrollKey === scrollKey ? scrollState.scrollTop : 0;
    const canOpen = canOpenViewFile(props.storeFolder, props.projectFolder, cursorFile, props.isTimeSpannedForFile(cursorFile, fileTime));
    const lines = useMemo(() => {
        if (!isOpen) {
            return [];
        }
        const text = readFileTextAtInstant(props.storeFolder, props.projectFolder, cursorFile, computeViewFileInstant(fileTime, nowTime, new Date()));
        return buildViewFileLines(text, cursorFile, props.terminalColumns);
    }, [isOpen, scrollKey, props.terminalColumns]);
    return {
        isOpen,
        canOpen,
        lines,
        scrollTop,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        scroll: (lineCountDelta, visibleLineCount) => setScrollState({ scrollKey, scrollTop: clampFileViewScrollTop(scrollTop + lineCountDelta, lines.length, visibleLineCount) }),
    };
}

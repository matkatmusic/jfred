// The View File state of the root component: open or closed, the lines of the file at its time, the diff with the newer text, and the scroll position.

import { useMemo, useState } from "react";
import type { Path } from "../../src/structures/domain.ts";
import type { AppProps } from "./engineV3_tui_app_types.ts";
import { computeLanguageForPath } from "../../webapp/highlight.ts";
import { computeDiffDisplay, type DiffDisplay } from "./engineV3_tui_diff_display.ts";
import { clampFileViewScrollTop, readFileTextAtInstant, type FileViewLine } from "./engineV3_tui_file_view_text.ts";
import { buildViewFileLines, canOpenViewFile, computeViewFileInstant } from "./engineV3_tui_view_file.ts";

export type ViewFileState = {
    isOpen: boolean;
    canOpen: boolean;
    isDiff: boolean;
    lines: FileViewLine[];
    diffView: DiffDisplay;
    scrollLineCount: number;
    scrollTop: number;
    open: () => void;
    close: () => void;
    toggleDiff: () => void;
    scroll: (lineCountDelta: number, visibleLineCount: number) => void;
};

const NO_DIFF_VIEW: DiffDisplay = { lines: [], emptyText: "" };

// A new file, a new time in the text view, or a switch between text and diff resets the scroll position to 0. The newer time is the time of the next newer event, or undefined at Now.
export function useViewFile(props: AppProps, cursorFile: Path, fileTime: Date, nowTime: Date, newerTime: Date | undefined): ViewFileState {
    const [isOpen, setIsOpen] = useState(false);
    const [isDiff, setIsDiff] = useState(false);
    const [scrollState, setScrollState] = useState({ scrollKey: "", scrollTop: 0 });
    const contentKey = `${cursorFile.value}|${fileTime.getTime()}|${isDiff}`;
    // The diff keeps its scroll position when the time changes: a step shows nearly the same lines.
    const scrollKey = isDiff ? `${cursorFile.value}|diff` : contentKey;
    const storedScrollTop = scrollState.scrollKey === scrollKey ? scrollState.scrollTop : 0;
    const canOpen = canOpenViewFile(props.storeFolder, props.projectFolder, cursorFile, props.isTimeSpannedForFile(cursorFile, fileTime));
    const lines = useMemo(() => {
        if (!isOpen) {
            return [];
        }
        if (isDiff) {
            return [];
        }
        const text = readFileTextAtInstant(props.storeFolder, props.projectFolder, cursorFile, computeViewFileInstant(fileTime, nowTime, new Date()));
        return buildViewFileLines(text, cursorFile, props.terminalColumns);
    }, [isOpen, contentKey, props.terminalColumns]);
    const diffView = useMemo(() => {
        if (!isOpen) {
            return NO_DIFF_VIEW;
        }
        if (!isDiff) {
            return NO_DIFF_VIEW;
        }
        const markerText = readFileTextAtInstant(props.storeFolder, props.projectFolder, cursorFile, computeViewFileInstant(fileTime, nowTime, new Date()));
        const newerText = newerTime === undefined ? undefined : readFileTextAtInstant(props.storeFolder, props.projectFolder, cursorFile, computeViewFileInstant(newerTime, nowTime, new Date()));
        return computeDiffDisplay(markerText, newerText, computeLanguageForPath(cursorFile.toString()), props.terminalColumns);
    }, [isOpen, contentKey, props.terminalColumns]);
    const scrollLineCount = isDiff ? diffView.lines.length : lines.length;
    const scrollTop = Math.min(storedScrollTop, Math.max(0, scrollLineCount - 1));
    return {
        isOpen,
        canOpen,
        isDiff,
        lines,
        diffView,
        scrollLineCount,
        scrollTop,
        open: () => setIsOpen(true),
        close: () => {
            setIsOpen(false);
            setIsDiff(false);
        },
        toggleDiff: () => setIsDiff(!isDiff),
        scroll: (lineCountDelta, visibleLineCount) => setScrollState({ scrollKey, scrollTop: clampFileViewScrollTop(scrollTop + lineCountDelta, scrollLineCount, visibleLineCount) }),
    };
}

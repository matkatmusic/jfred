// The drawer state of the root component: which box is open between the info box and the hotkeys box, its row split, its hotkeys rows.

import { useMemo, useState, type ReactNode } from "react";
import { AppBoxMode, JumpSpeed, TuiCommand } from "../../src/structures/vocabulary.ts";
import type { Path } from "../../src/structures/domain.ts";
import { useViewFile } from "./engineV3_tui_app_view_file.ts";
import type { AppProps } from "./engineV3_tui_app_types.ts";
import { TUI_COLORS } from "./engineV3_tui_colors.ts";
import { ConsoleBox, clampConsoleScrollTop } from "./engineV3_tui_console_box.tsx";
import { DiffBox } from "./engineV3_tui_diff_box.tsx";
import { computeDrawerLayout } from "./engineV3_tui_drawer_layout.ts";
import type { FooterEntry } from "./engineV3_tui_footer.tsx";
import { basename } from "node:path";
import { FileViewBox } from "./engineV3_tui_file_view_box.tsx";
import { HOTKEYS_BOX_ROW_COUNT, countHotKeysBoxRows } from "./engineV3_tui_hotkeys_box.tsx";
import { buildConsoleHotKeyRows, buildFileViewHotKeyRows, buildHotKeyRows, type HotKeyRow } from "./engineV3_tui_hotkeys_rows.ts";
import { KeyBox, buildKeymapOfKeyBox, type KeyBoxSettings, type Keymap } from "./engineV3_tui_keymap.ts";
import { MARKER_BOX_ROW_COUNT } from "./engineV3_tui_marker_box.tsx";
import { LEGEND_ROW_COUNT } from "./engineV3_tui_legend_frame.tsx";

const BOX_BORDER_ROWS = 2;
const NO_TEXT_EMPTY_TEXT = "no stored text at this time";

export type AppDrawerInput = {
    props: AppProps;
    cursorFile: Path;
    fileTime: Date;
    nowTime: Date;
    newerTime: Date | undefined;
    speed: JumpSpeed;
    infoLines: FooterEntry[][];
    markedPosition: number;
    eventCount: number;
    isMarkerBoxForAllFiles: boolean;
};

export type AppDrawerState = {
    boxMode: AppBoxMode;
    fileViewKeymap: Keymap;
    consoleKeymap: Keymap;
    keyBox: KeyBoxSettings;
    hotKeyRows: HotKeyRow[];
    drawer: ReactNode;
    rowsHeight: number | undefined;
    footerRowCount: number;
    openViewFile: () => void;
    openConsole: () => void;
    closeBox: () => void;
    toggleDiff: () => void;
    scrollDrawer: (lineCountDelta: number) => void;
};

// The info box is hidden while a drawer is open: the drawer starts at the halfway row and takes the rows the info box had.
// function computeDrawerGeometry(props: AppProps, infoLines: FooterEntry[][], hotKeysRowCount: number) {
function computeDrawerGeometry(props: AppProps, hotKeysRowCount: number) {
    // const layout = computeDrawerLayout(props.terminalRows, infoLines.length + BOX_BORDER_ROWS, hotKeysRowCount);
    const layout = computeDrawerLayout(props.terminalRows, 0, hotKeysRowCount);
    const aboveRowsRowCount = LEGEND_ROW_COUNT + MARKER_BOX_ROW_COUNT;
    return {
        drawerRowCount: layout.drawerRowCount,
        visibleLineCount: layout.drawerRowCount - BOX_BORDER_ROWS,
        rowsHeight: layout.aboveInfoRowCount - 1 - aboveRowsRowCount,
        footerRowCount: props.terminalRows - layout.aboveInfoRowCount + aboveRowsRowCount,
    };
}

function listDisabledScrollCommands(scrollTop: number, lineCount: number, visibleLineCount: number): TuiCommand[] {
    const disabledCommands: TuiCommand[] = [];
    if (scrollTop === 0) {
        disabledCommands.push(TuiCommand.ScrollUp);
    }
    if (scrollTop >= lineCount - visibleLineCount) {
        disabledCommands.push(TuiCommand.ScrollDown);
    }
    return disabledCommands;
}

export function useAppDrawer(input: AppDrawerInput): AppDrawerState {
    const { props, speed, infoLines } = input;
    const [boxMode, setBoxMode] = useState(AppBoxMode.Browse);
    const [consoleScrollTop, setConsoleScrollTop] = useState<number | undefined>(undefined);
    const viewFile = useViewFile(props, input.cursorFile, input.fileTime, input.nowTime, input.newerTime);
    const fileViewKeymap = useMemo(() => buildKeymapOfKeyBox(props.keyBoxes[KeyBox.FileView]), [props.keyBoxes]);
    const consoleKeymap = useMemo(() => buildKeymapOfKeyBox(props.keyBoxes[KeyBox.Console]), [props.keyBoxes]);
    const openViewFile = (): void => {
        if (viewFile.canOpen) {
            viewFile.open();
            setBoxMode(AppBoxMode.ViewFile);
        }
    };
    const openConsole = (): void => {
        setConsoleScrollTop(undefined);
        setBoxMode(AppBoxMode.Console);
    };
    const closeBox = (): void => {
        viewFile.close();
        setBoxMode(AppBoxMode.Browse);
    };
    const base = { boxMode, fileViewKeymap, consoleKeymap, openViewFile, openConsole, closeBox, toggleDiff: viewFile.toggleDiff };
    if (boxMode === AppBoxMode.ViewFile) {
        const keyBox = props.keyBoxes[KeyBox.FileView];
        // const geometry = computeDrawerGeometry(props, infoLines, countHotKeysBoxRows(buildFileViewHotKeyRows(keyBox, [])));
        const geometry = computeDrawerGeometry(props, countHotKeysBoxRows(buildFileViewHotKeyRows(keyBox, [])));
        const disabledCommands = listDisabledScrollCommands(viewFile.scrollTop, viewFile.scrollLineCount, geometry.visibleLineCount);
        if (input.markedPosition === input.eventCount) {
            disabledCommands.push(TuiCommand.ViewFileStepTowardsEarliest);
        }
        if (input.markedPosition === 0) {
            disabledCommands.push(TuiCommand.ViewFileStepTowardsNow);
        }
        let drawer = <FileViewBox fileName={basename(input.cursorFile.toString())} lines={viewFile.lines} scrollTop={viewFile.scrollTop} rowCount={geometry.drawerRowCount} columns={props.terminalColumns} lineNumberColor={TUI_COLORS.fileViewBox.lineNumberColor} textColor={TUI_COLORS.fileViewBox.textColor} emptyText={viewFile.isDiff ? viewFile.diffView.emptyText : NO_TEXT_EMPTY_TEXT} />;
        if (viewFile.diffView.lines.length > 0) {
            drawer = <DiffBox lines={viewFile.diffView.lines} scrollTop={viewFile.scrollTop} rowCount={geometry.drawerRowCount} columns={props.terminalColumns} textColor={TUI_COLORS.diffBox.textColor} lineNumberColor={TUI_COLORS.diffBox.lineNumberColor} newerOnlyBackgroundColor={TUI_COLORS.diffBox.newerOnlyBackgroundColor} markerOnlyBackgroundColor={TUI_COLORS.diffBox.markerOnlyBackgroundColor} changedBackgroundColor={TUI_COLORS.diffBox.changedBackgroundColor} />;
        }
        return { ...base, keyBox, hotKeyRows: buildFileViewHotKeyRows(keyBox, disabledCommands), drawer, rowsHeight: geometry.rowsHeight, footerRowCount: geometry.footerRowCount, scrollDrawer: (lineCountDelta) => viewFile.scroll(lineCountDelta, geometry.visibleLineCount) };
    }
    if (boxMode === AppBoxMode.Console) {
        const keyBox = props.keyBoxes[KeyBox.Console];
        // const geometry = computeDrawerGeometry(props, infoLines, countHotKeysBoxRows(buildConsoleHotKeyRows(keyBox, [])));
        const geometry = computeDrawerGeometry(props, countHotKeysBoxRows(buildConsoleHotKeyRows(keyBox, [])));
        const lines = props.engineLog.listLines();
        const scrollTop = clampConsoleScrollTop(consoleScrollTop ?? lines.length, lines.length, geometry.visibleLineCount);
        const disabledCommands = listDisabledScrollCommands(scrollTop, lines.length, geometry.visibleLineCount);
        const drawer = <ConsoleBox lines={lines} scrollTop={scrollTop} rowCount={geometry.drawerRowCount} columns={props.terminalColumns} summaryColor={TUI_COLORS.consoleBox.summaryColor} rawColor={TUI_COLORS.consoleBox.rawColor} />;
        return { ...base, keyBox, hotKeyRows: buildConsoleHotKeyRows(keyBox, disabledCommands), drawer, rowsHeight: geometry.rowsHeight, footerRowCount: geometry.footerRowCount, scrollDrawer: (lineCountDelta) => setConsoleScrollTop(clampConsoleScrollTop(scrollTop + lineCountDelta, lines.length, geometry.visibleLineCount)) };
    }
    const keyBox = props.keyBoxes[KeyBox.Global];
    const disabledCommands = viewFile.canOpen ? [] : [TuiCommand.ViewFile];
    return {
        ...base,
        keyBox,
        hotKeyRows: buildHotKeyRows(keyBox, speed, disabledCommands, input.isMarkerBoxForAllFiles),
        drawer: null,
        rowsHeight: undefined,
        footerRowCount: infoLines.length + BOX_BORDER_ROWS + MARKER_BOX_ROW_COUNT + HOTKEYS_BOX_ROW_COUNT + LEGEND_ROW_COUNT,
        scrollDrawer: () => {},
    };
}

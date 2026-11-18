// The root component of the terminal UI: header, visible file rows, info row, menu row.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus, JumpSpeed, MarkerDirection } from "../../src/structures/vocabulary.ts";
import type { BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { getRelativePathInProject } from "../engineV3_inverse_repos_for_project.ts";
import type { AppProps, FileTimes, SelectionState } from "./engineV3_tui_app_types.ts";
import { useAppKeys } from "./engineV3_tui_app_keys.ts";
import { AppLayout } from "./engineV3_tui_app_layout.tsx";
import { buildFileRowElements } from "./engineV3_tui_app_row_elements.tsx";
import { getMemoizedFileModel, stepProjectMarker, stepSelectedFiles, type FileModelMemo, type StepContext } from "./engineV3_tui_app_steps.ts";
import { describeBarInfo } from "./engineV3_tui_bars.ts";
import { chooseFileForPlayKey, getNextConsentQuestion } from "./engineV3_tui_consent.ts";
import { ConsentPopup } from "./engineV3_tui_consent_popup.tsx";
// import { countBoxRows } from "./engineV3_tui_footer.tsx";
import { TUI_COLORS } from "./engineV3_tui_colors.ts";
// import { countLinesBoxRows } from "./engineV3_tui_footer.tsx";
import { useAppDrawer } from "./engineV3_tui_app_drawer.tsx";
import { MarkerBox } from "./engineV3_tui_marker_box.tsx";
import { computeMarkedPosition, listEventInstants } from "./engineV3_tui_marker_position.ts";
import { useMarkerWindowStart } from "./engineV3_tui_marker_window.ts";
// import { HOTKEYS_BOX_ROW_COUNT } from "./engineV3_tui_hotkeys_box.tsx";
// import { KeyBox } from "./engineV3_tui_keymap.ts";
import { LEGEND_ROW_COUNT, LegendFrame } from "./engineV3_tui_legend_frame.tsx";
import { computeRowColumnWidths } from "./engineV3_tui_row_columns.ts";
// import { buildInfoEntries } from "./engineV3_tui_info_row.tsx";
import { buildInfoBoxLines } from "./engineV3_tui_info_row.tsx";
import { NoEventsScreen } from "./engineV3_tui_no_events.tsx";
import { useTerminalSize } from "./engineV3_tui_terminal_size.ts";
import { foldEventsIntoRulerRows, listEventsOfFile, type TimeMarker } from "./engineV3_tui_time_marker.ts";
import { getAvailableRowCount, getVisibleRowRange } from "./engineV3_tui_viewport.ts";
import { getFileRunState } from "./engineV3_tui_walk_state.ts";

const RULER_ROW_LIMIT = 200;

export function App(startProps: AppProps) {
    const terminalSize = useTerminalSize({ terminalRows: startProps.terminalRows, terminalColumns: startProps.terminalColumns });
    const props: AppProps = { ...startProps, ...terminalSize };
    if (props.events.length === 0) {
        return <LegendFrame><NoEventsScreen terminalRows={props.terminalRows - LEGEND_ROW_COUNT} /></LegendFrame>;
    }
    return <LoadedApp {...props} />;
}

function LoadedApp(props: AppProps) {
    const [marker, setMarker] = useState<TimeMarker>({ instant: props.events[0]!.instant, eventIndex: 0 });
    const [speed, setSpeed] = useState(JumpSpeed.Event);
    const [selection, setSelection] = useState<SelectionState>({ cursorIndex: 0, selectedFiles: [], lastToggledIndex: undefined });
    const [fileTimes, setFileTimes] = useState<FileTimes>(new Map());
    const [, setRenderCount] = useState(0);
    const previousTop = useRef(0);
    const modelMemo = useRef<FileModelMemo>(new Map());
    const rulerRows = useMemo(() => foldEventsIntoRulerRows(props.events, RULER_ROW_LIMIT), [props.events]);
    const bounds = { newest: props.events[0]!.instant, oldest: props.events[props.events.length - 1]!.instant };
    const consentQuestion = getNextConsentQuestion(props.consentAnswers, props.scriptCounts);
    // const range = getVisibleRowRange(props.files.length, selection.cursorIndex, previousTop.current, getAvailableRowCount(props.terminalRows));
    const cursorFile = props.files[selection.cursorIndex]!;
    const selectedOrCursorFiles = selection.selectedFiles.length > 0 ? selection.selectedFiles : [cursorFile];

    const getTimeOfFile = (file: Path): Date => fileTimes.get(file.value) ?? marker.instant;
    const getModelOfFile = (file: Path): BarFileModel => getMemoizedFileModel(modelMemo.current, props, rulerRows, file);
    const cursorRunState = getFileRunState(props.walkState, cursorFile);
    const infoInput = {
        fileName: getRelativePathInProject(props.projectFolder, cursorFile),
        barInfo: describeBarInfo(getModelOfFile(cursorFile), props.countsByFile.get(cursorFile.value)!, cursorRunState),
        runState: cursorRunState,
        ownTime: fileTimes.get(cursorFile.value),
        isTimeSpanned: props.isTimeSpannedForFile(cursorFile, getTimeOfFile(cursorFile)),
        scriptRefusalText: undefined,
    };
    // const detailEntries = buildInfoEntries(infoInput);
    const infoLines = buildInfoBoxLines(infoInput, props.terminalColumns);
    // const eventInstants = listEventInstants(getModelOfFile(cursorFile).commits);
    // const eventInstants = listEventInstants(listEventsOfFile(props.events, cursorFile));
    const eventInstants = listEventInstants(listEventsOfFile(props.events, cursorFile), bounds.newest);
    const markedPosition = computeMarkedPosition(eventInstants, getTimeOfFile(cursorFile), bounds.newest);
    const windowStart = useMarkerWindowStart(cursorFile, eventInstants.length, markedPosition, props.terminalColumns);
    const markerBox = <MarkerBox eventInstants={eventInstants} markedPosition={markedPosition} windowStart={windowStart} columns={props.terminalColumns} markedColor={TUI_COLORS.markerBox.markedColor} arrowColor={TUI_COLORS.markerBox.arrowColor} timeColor={TUI_COLORS.markerBox.timeColor} />;
    // const keyEntries = buildKeyFooterEntries(props.keymap, speed);
    // const footerRowCount = countBoxRows(detailEntries, props.terminalColumns) + countBoxRows(keyEntries, props.terminalColumns) + LEGEND_ROW_COUNT;
    // const footerRowCount = countBoxRows(detailEntries, props.terminalColumns) + HOTKEYS_BOX_ROW_COUNT + LEGEND_ROW_COUNT;
    // const footerRowCount = countLinesBoxRows(infoLines) + MARKER_BOX_ROW_COUNT + HOTKEYS_BOX_ROW_COUNT + LEGEND_ROW_COUNT;
    const drawerState = useAppDrawer({ props, cursorFile, fileTime: getTimeOfFile(cursorFile), nowTime: bounds.newest, speed, infoLines, markedPosition, eventCount: eventInstants.length });
    const footerRowCount = drawerState.footerRowCount;
    const longestNameLength = Math.max(...props.files.map((file) => getRelativePathInProject(props.projectFolder, file).length));
    const rowColumnWidths = computeRowColumnWidths(props.terminalColumns, longestNameLength);
    const range = getVisibleRowRange(props.files.length, selection.cursorIndex, previousTop.current, getAvailableRowCount(props.terminalRows, footerRowCount));
    previousTop.current = range.top;
    const visibleFiles = props.files.slice(range.top, range.bottom);

    useEffect(() => props.subscribeToStatusChanges(() => setRenderCount((renderCount) => renderCount + 1)), []);
    useEffect(() => {
        for (const file of visibleFiles) {
            if (!props.isTimeSpannedForFile(file, getTimeOfFile(file))) {
                if (getFileRunState(props.walkState, file).status === FileWalkStatus.Idle) {
                    props.walker.walkHistoryTo(getTimeOfFile(file), file, true);
                }
            }
        }
    }, [range.top, range.bottom, marker]);

    const stepContext: StepContext = { props, speed, marker, bounds, range, getTimeOfFile };
    const stepSelectedFilesInDirection = (direction: MarkerDirection): void => setFileTimes(stepSelectedFiles(stepContext, selectedOrCursorFiles, fileTimes, direction));
    const stepProjectMarkerInDirection = (direction: MarkerDirection): void => {
        setMarker(stepProjectMarker(stepContext, direction));
        setFileTimes(new Map());
    };
    const stepCursorFileInDirection = (direction: MarkerDirection): void => setFileTimes(stepSelectedFiles(stepContext, [cursorFile], fileTimes, direction));
    // const reconstructCursorFile = (): void => void props.walker.walkHistoryTo(new Date(0), cursorFile, true);
    const reconstructCursorFile = (): void => {
        const runStatus = getFileRunState(props.walkState, cursorFile).status;
        if (runStatus === FileWalkStatus.Running) {
            return;
        }
        if (runStatus === FileWalkStatus.Queued) {
            return;
        }
        void props.walker.walkHistoryTo(new Date(0), cursorFile, true);
    };
    const playScriptOfCursorFile = (): void => {
        const file = chooseFileForPlayKey(cursorFile, selection.selectedFiles);
        if (getFileRunState(props.walkState, file).status === FileWalkStatus.Stopped) {
            // void props.onPlayScript(file);
            void props.onPlayScript(file, getTimeOfFile(file));
        }
    };
    const refreshScreen = (): void => setRenderCount((renderCount) => renderCount + 1);

    useAppKeys({ props, consentQuestion, selection, speed, selectedOrCursorFiles, modelMemo: modelMemo.current, setSelection, setSpeed, refreshScreen, stepSelectedFilesInDirection, stepProjectMarkerInDirection, playScriptOfCursorFile, boxMode: drawerState.boxMode, fileViewKeymap: drawerState.fileViewKeymap, openViewFile: drawerState.openViewFile, closeBox: drawerState.closeBox, scrollDrawer: drawerState.scrollDrawer, stepCursorFileInDirection, consoleKeymap: drawerState.consoleKeymap, openConsole: drawerState.openConsole, reconstructCursorFile });

    const rows = buildFileRowElements({ props, visibleFiles, rangeTop: range.top, selection, rulerRows, rowColumnWidths, getModelOfFile, getTimeOfFile });
    // const headerText = consentQuestion?.questionText ?? props.cacheStatusText ?? `marker ${marker.instant.toISOString()}`;
    const staleText = props.staleRepoCount > 0 ? `${props.staleRepoCount} repos are stale: press Shift-R` : undefined;
    // const headerText = consentQuestion?.questionText ?? staleText ?? props.cacheStatusText ?? `marker ${marker.instant.toISOString()}`;
    const headerText = consentQuestion?.questionText ?? staleText ?? props.cacheStatusText ?? "";
    if (consentQuestion !== undefined) {
        const answerConsentQuestion = (answer: boolean): void => {
            props.onConsentAnswered(consentQuestion.answerKey, answer);
            refreshScreen();
        };
        return <LegendFrame><ConsentPopup questionText={consentQuestion.questionText} terminalRows={props.terminalRows - LEGEND_ROW_COUNT} terminalColumns={props.terminalColumns} onAnswer={answerConsentQuestion} /></LegendFrame>;
    }
    return <AppLayout terminalRows={props.terminalRows} terminalColumns={props.terminalColumns} headerText={headerText} isCacheLoading={props.cacheStatusText !== undefined} rows={rows} markerBox={markerBox} infoLines={infoLines} keyBox={drawerState.keyBox} hotKeyRows={drawerState.hotKeyRows} drawer={drawerState.drawer} rowsHeight={drawerState.rowsHeight} />;
}

// The root component of the terminal UI: header, visible file rows, info row, menu row.

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus, JumpSpeed, MarkerDirection, TuiCommand } from "../../src/structures/vocabulary.ts";
import type { BarFileModel } from "../../webapp/layer1-components/bars-view/layer1-bars-model.ts";
import { findRulerRowIndexForInstant } from "../../webapp/layer1-components/bars-view/layer1-bars-ruler.ts";
import { getRelativePathInProject } from "../engineV3_inverse_repos_for_project.ts";
import type { AppProps, FileTimes, SelectionState } from "./engineV3_tui_app_types.ts";
import { describeRowState } from "./engineV3_tui_app_rows.ts";
import { extendSelectionToCursor, moveCursor, toggleCursorFile } from "./engineV3_tui_app_selection.ts";
import { getMemoizedFileModel, stepProjectMarker, stepSelectedFiles, type FileModelMemo, type StepContext } from "./engineV3_tui_app_steps.ts";
import { Barbershop } from "./engineV3_tui_barbershop.tsx";
import { describeBarInfo } from "./engineV3_tui_bars.ts";
import { chooseFileForPlayKey, getNextConsentQuestion } from "./engineV3_tui_consent.ts";
import { ConsentPopup } from "./engineV3_tui_consent_popup.tsx";
import { DetailsBox, KeyFooter, buildKeyFooterEntries, countBoxRows } from "./engineV3_tui_footer.tsx";
import { buildInfoEntries } from "./engineV3_tui_info_row.tsx";
import { findCommandForKey } from "./engineV3_tui_keymap.ts";
import { NoEventsScreen } from "./engineV3_tui_no_events.tsx";
import { Row } from "./engineV3_tui_row.tsx";
import { foldEventsIntoRulerRows, toggleJumpSpeed, type TimeMarker } from "./engineV3_tui_time_marker.ts";
import { getAvailableRowCount, getVisibleRowRange } from "./engineV3_tui_viewport.ts";
import { getFileRunState } from "./engineV3_tui_walk_state.ts";

const BAR_WIDTH = 30;
const RULER_ROW_LIMIT = 200;

export function App(props: AppProps) {
    if (props.events.length === 0) {
        return <NoEventsScreen terminalRows={props.terminalRows} />;
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
    const detailEntries = buildInfoEntries({
        fileName: getRelativePathInProject(props.projectFolder, cursorFile),
        barInfo: describeBarInfo(getModelOfFile(cursorFile), props.countsByFile.get(cursorFile.value)!, cursorRunState),
        runState: cursorRunState,
        ownTime: fileTimes.get(cursorFile.value),
        isTimeSpanned: props.isTimeSpannedForFile(cursorFile, getTimeOfFile(cursorFile)),
        scriptRefusalText: undefined,
    });
    const keyEntries = buildKeyFooterEntries(props.keymap, speed);
    const footerRowCount = countBoxRows(detailEntries, props.terminalColumns) + countBoxRows(keyEntries, props.terminalColumns);
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
    const playScriptOfCursorFile = (): void => {
        const file = chooseFileForPlayKey(cursorFile, selection.selectedFiles);
        if (getFileRunState(props.walkState, file).status === FileWalkStatus.Stopped) {
            // void props.onPlayScript(file);
            void props.onPlayScript(file, getTimeOfFile(file));
        }
    };

    useInput((input, key) => {
        if (consentQuestion !== undefined) {
            if (input === "y") {
                props.onConsentAnswered(consentQuestion.answerKey, true);
            }
            if (input === "n") {
                props.onConsentAnswered(consentQuestion.answerKey, false);
            }
            setRenderCount((renderCount) => renderCount + 1);
            return;
        }
        switch (findCommandForKey(props.keymap, input, key)) {
            case TuiCommand.MoveSelectionUp: return setSelection(moveCursor(selection, props.files, -1));
            case TuiCommand.MoveSelectionDown: return setSelection(moveCursor(selection, props.files, 1));
            case TuiCommand.ToggleSelection: return setSelection(toggleCursorFile(selection, props.files));
            case TuiCommand.ExtendSelection: return setSelection(extendSelectionToCursor(selection, props.files));
            case TuiCommand.ToggleDaySpeed: return setSpeed(toggleJumpSpeed(speed, JumpSpeed.Day));
            case TuiCommand.ToggleWeekSpeed: return setSpeed(toggleJumpSpeed(speed, JumpSpeed.Week));
            case TuiCommand.StepSelectionTowardsNow: return stepSelectedFilesInDirection(MarkerDirection.TowardsNow);
            case TuiCommand.StepSelectionTowardsEarliest: return stepSelectedFilesInDirection(MarkerDirection.TowardsEarliest);
            case TuiCommand.StepAllTowardsNow: return stepProjectMarkerInDirection(MarkerDirection.TowardsNow);
            case TuiCommand.StepAllTowardsEarliest: return stepProjectMarkerInDirection(MarkerDirection.TowardsEarliest);
            case TuiCommand.ResetSelectedStores:
                selectedOrCursorFiles.forEach((file) => modelMemo.current.delete(file.value));
                return void props.onResetSelectedStores(selectedOrCursorFiles);
            case TuiCommand.ResetAllStores:
                modelMemo.current.clear();
                return void props.onResetAllStores();
            case TuiCommand.PlayScript: return playScriptOfCursorFile();
        }
    });

    const rows = visibleFiles.map((file, offset) => {
        const model = getModelOfFile(file);
        const markerRowIndex = findRulerRowIndexForInstant(rulerRows, getTimeOfFile(file).toISOString());
        return <Row key={file.value} fileName={getRelativePathInProject(props.projectFolder, file)} model={model} status={getFileRunState(props.walkState, file).status} markerRowIndex={markerRowIndex} rulerRowCount={rulerRows.length} barWidth={BAR_WIDTH} isCursor={range.top + offset === selection.cursorIndex} isSelected={selection.selectedFiles.some((selectedFile) => selectedFile.value === file.value)} stateText={describeRowState(model, getTimeOfFile(file), markerRowIndex)} />;
    });
    // const headerText = consentQuestion?.questionText ?? props.cacheStatusText ?? `marker ${marker.instant.toISOString()}`;
    const staleText = props.staleRepoCount > 0 ? `${props.staleRepoCount} repos are stale: press Shift-R` : undefined;
    const headerText = consentQuestion?.questionText ?? staleText ?? props.cacheStatusText ?? `marker ${marker.instant.toISOString()}`;
    if (consentQuestion !== undefined) {
        const answerConsentQuestion = (answer: boolean): void => {
            props.onConsentAnswered(consentQuestion.answerKey, answer);
            setRenderCount((renderCount) => renderCount + 1);
        };
        return <ConsentPopup questionText={consentQuestion.questionText} terminalRows={props.terminalRows} terminalColumns={props.terminalColumns} onAnswer={answerConsentQuestion} />;
    }
    return (
        <Box flexDirection="column" height={props.terminalRows}>
            <Box gap={1}>
                <Text wrap="truncate">{headerText}</Text>
                {props.cacheStatusText !== undefined && <Barbershop width={BAR_WIDTH} />}
            </Box>
            <Box flexDirection="column" flexGrow={1}>{rows}</Box>
            {/* <Box height={1}><Text wrap="truncate-end">{infoRowText}</Text></Box> */}
            {/* <MenuRow keymap={props.keymap} speed={speed} /> */}
            <DetailsBox entries={detailEntries} columns={props.terminalColumns} />
            <KeyFooter entries={keyEntries} columns={props.terminalColumns} />
        </Box>
    );
}

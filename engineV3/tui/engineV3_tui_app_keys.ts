// The key handling of the root component: one switch from the keymap command to the action.

import { useApp, useInput, type Key } from "ink";
import type { Path } from "../../src/structures/domain.ts";
import { AppBoxMode, JumpSpeed, MarkerDirection, TuiCommand } from "../../src/structures/vocabulary.ts";
import type { AppProps, SelectionState } from "./engineV3_tui_app_types.ts";
import { extendSelectionToCursor, moveCursor, toggleCursorFile } from "./engineV3_tui_app_selection.ts";
import type { FileModelMemo } from "./engineV3_tui_app_steps.ts";
import type { ConsentQuestion } from "./engineV3_tui_consent.ts";
import { findCommandForKey, type Keymap } from "./engineV3_tui_keymap.ts";
import { toggleJumpSpeed } from "./engineV3_tui_time_marker.ts";

export type AppKeyContext = {
    props: AppProps;
    consentQuestion: ConsentQuestion | undefined;
    selection: SelectionState;
    speed: JumpSpeed;
    selectedOrCursorFiles: Path[];
    modelMemo: FileModelMemo;
    setSelection: (selection: SelectionState) => void;
    setSpeed: (speed: JumpSpeed) => void;
    refreshScreen: () => void;
    stepInDirection: (direction: MarkerDirection) => void;
    toggleMarkerBoxScope: () => void;
    toggleGuessFilter: () => void;
    shownFiles: Path[];
    playScriptOfCursorFile: () => void;
    boxMode: AppBoxMode;
    fileViewKeymap: Keymap;
    openViewFile: () => void;
    closeBox: () => void;
    toggleDiff: () => void;
    scrollDrawer: (lineCountDelta: number) => void;
    stepCursorFileInDirection: (direction: MarkerDirection) => void;
    consoleKeymap: Keymap;
    openConsole: () => void;
    reconstructCursorFile: () => void;
    moveCursorByPage: (direction: 1 | -1) => void;
};

function handleConsoleKey(context: AppKeyContext, input: string, key: Key, quit: () => void): void {
    switch (findCommandForKey(context.consoleKeymap, input, key)) {
        case TuiCommand.Quit: return quit();
        case TuiCommand.ScrollUp: return context.scrollDrawer(-1);
        case TuiCommand.ScrollDown: return context.scrollDrawer(1);
        case TuiCommand.CloseBox: return context.closeBox();
        case TuiCommand.OpenLogFolder: return context.props.openLogFolder();
    }
}

function handleViewFileKey(context: AppKeyContext, input: string, key: Key, quit: () => void): void {
    switch (findCommandForKey(context.fileViewKeymap, input, key)) {
        case TuiCommand.Quit: return quit();
        case TuiCommand.ScrollUp: return context.scrollDrawer(-1);
        case TuiCommand.ScrollDown: return context.scrollDrawer(1);
        case TuiCommand.CloseBox: return context.closeBox();
        case TuiCommand.ToggleDiffView: return context.toggleDiff();
        case TuiCommand.ViewFileStepTowardsEarliest: return context.stepCursorFileInDirection(MarkerDirection.TowardsEarliest);
        case TuiCommand.ViewFileStepTowardsNow: return context.stepCursorFileInDirection(MarkerDirection.TowardsNow);
        case TuiCommand.ToggleDaySpeed: return context.setSpeed(toggleJumpSpeed(context.speed, JumpSpeed.Day));
        case TuiCommand.ToggleWeekSpeed: return context.setSpeed(toggleJumpSpeed(context.speed, JumpSpeed.Week));
    }
}

export function useAppKeys(context: AppKeyContext): void {
    const { props, consentQuestion, selection, speed, selectedOrCursorFiles, modelMemo } = context;
    // exit ends the Ink app like Ctrl-C does: jfredTUI then runs shutdownTui
    const { exit: quit } = useApp();
    useInput((input, key) => {
        if (consentQuestion !== undefined) {
            if (input === "y") {
                props.onConsentAnswered(consentQuestion.answerKey, true);
            }
            if (input === "n") {
                props.onConsentAnswered(consentQuestion.answerKey, false);
            }
            context.refreshScreen();
            return;
        }
        if (context.boxMode === AppBoxMode.ViewFile) {
            return handleViewFileKey(context, input, key, quit);
        }
        if (context.boxMode === AppBoxMode.Console) {
            return handleConsoleKey(context, input, key, quit);
        }
        switch (findCommandForKey(props.keymap, input, key)) {
            case TuiCommand.Quit: return quit();
            case TuiCommand.ViewFile: return context.openViewFile();
            case TuiCommand.OpenConsole: return context.openConsole();
            case TuiCommand.ReconstructUntilEarliest: return context.reconstructCursorFile();
            case TuiCommand.MoveSelectionUp: return context.setSelection(moveCursor(selection, context.shownFiles, -1));
            case TuiCommand.MoveSelectionDown: return context.setSelection(moveCursor(selection, context.shownFiles, 1));
            case TuiCommand.MoveSelectionPageUp: return context.moveCursorByPage(-1);
            case TuiCommand.MoveSelectionPageDown: return context.moveCursorByPage(1);
            case TuiCommand.ToggleSelection: return context.setSelection(toggleCursorFile(selection, context.shownFiles));
            case TuiCommand.ExtendSelection: return context.setSelection(extendSelectionToCursor(selection, context.shownFiles));
            case TuiCommand.SetEventSpeed: return context.setSpeed(JumpSpeed.Event);
            case TuiCommand.ToggleDaySpeed: return context.setSpeed(toggleJumpSpeed(speed, JumpSpeed.Day));
            case TuiCommand.ToggleWeekSpeed: return context.setSpeed(toggleJumpSpeed(speed, JumpSpeed.Week));
            case TuiCommand.StepSelectionTowardsNow: return context.stepInDirection(MarkerDirection.TowardsNow);
            case TuiCommand.StepSelectionTowardsEarliest: return context.stepInDirection(MarkerDirection.TowardsEarliest);
            // The Shift+Left and Shift+Right keys are removed: Left and Right step all rows while the Marker Box shows all files.
            // case TuiCommand.StepAllTowardsNow: return context.stepProjectMarkerInDirection(MarkerDirection.TowardsNow);
            // case TuiCommand.StepAllTowardsEarliest: return context.stepProjectMarkerInDirection(MarkerDirection.TowardsEarliest);
            case TuiCommand.ToggleMarkerBoxScope: return context.toggleMarkerBoxScope();
            case TuiCommand.ToggleGuessFilter: return context.toggleGuessFilter();
            case TuiCommand.ResetSelectedStores:
                selectedOrCursorFiles.forEach((file) => modelMemo.delete(file.value));
                return void props.onResetSelectedStores(selectedOrCursorFiles);
            case TuiCommand.ResetAllStores:
                modelMemo.clear();
                return void props.onResetAllStores();
            case TuiCommand.PlayScript: return context.playScriptOfCursorFile();
        }
    });
}

// The key handling of the root component: one switch from the keymap command to the action.

import { useInput, type Key } from "ink";
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
    stepSelectedFilesInDirection: (direction: MarkerDirection) => void;
    stepProjectMarkerInDirection: (direction: MarkerDirection) => void;
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
};

function handleConsoleKey(context: AppKeyContext, input: string, key: Key): void {
    switch (findCommandForKey(context.consoleKeymap, input, key)) {
        case TuiCommand.ScrollUp: return context.scrollDrawer(-1);
        case TuiCommand.ScrollDown: return context.scrollDrawer(1);
        case TuiCommand.CloseBox: return context.closeBox();
        case TuiCommand.OpenLogFolder: return context.props.openLogFolder();
    }
}

function handleViewFileKey(context: AppKeyContext, input: string, key: Key): void {
    switch (findCommandForKey(context.fileViewKeymap, input, key)) {
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
            return handleViewFileKey(context, input, key);
        }
        if (context.boxMode === AppBoxMode.Console) {
            return handleConsoleKey(context, input, key);
        }
        switch (findCommandForKey(props.keymap, input, key)) {
            case TuiCommand.ViewFile: return context.openViewFile();
            case TuiCommand.OpenConsole: return context.openConsole();
            case TuiCommand.ReconstructUntilEarliest: return context.reconstructCursorFile();
            case TuiCommand.MoveSelectionUp: return context.setSelection(moveCursor(selection, props.files, -1));
            case TuiCommand.MoveSelectionDown: return context.setSelection(moveCursor(selection, props.files, 1));
            case TuiCommand.ToggleSelection: return context.setSelection(toggleCursorFile(selection, props.files));
            case TuiCommand.ExtendSelection: return context.setSelection(extendSelectionToCursor(selection, props.files));
            case TuiCommand.SetEventSpeed: return context.setSpeed(JumpSpeed.Event);
            case TuiCommand.ToggleDaySpeed: return context.setSpeed(toggleJumpSpeed(speed, JumpSpeed.Day));
            case TuiCommand.ToggleWeekSpeed: return context.setSpeed(toggleJumpSpeed(speed, JumpSpeed.Week));
            case TuiCommand.StepSelectionTowardsNow: return context.stepSelectedFilesInDirection(MarkerDirection.TowardsNow);
            case TuiCommand.StepSelectionTowardsEarliest: return context.stepSelectedFilesInDirection(MarkerDirection.TowardsEarliest);
            case TuiCommand.StepAllTowardsNow: return context.stepProjectMarkerInDirection(MarkerDirection.TowardsNow);
            case TuiCommand.StepAllTowardsEarliest: return context.stepProjectMarkerInDirection(MarkerDirection.TowardsEarliest);
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

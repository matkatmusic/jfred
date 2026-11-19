// The rows of the hotkeys box: named rows built from the keys of one box of keymap.json.

import { JumpSpeed, TuiCommand } from "../../src/structures/vocabulary.ts";
import { formatKeyBinding, type KeyBoxSettings } from "./engineV3_tui_keymap.ts";

export type HotKeyItem = { keyLabel: string | undefined; text: string; keyColor: string; isDisabled: boolean };
export type HotKeyRow = { name: string; itemSeparator: string; items: HotKeyItem[]; warningText: string | undefined; rightText: string | undefined };

// const DAY_OR_WEEK_WARNING_TEXT = "! left/right: not in marker box";

const NAVIGATION_COMMANDS = [TuiCommand.MoveSelectionUp, TuiCommand.MoveSelectionDown, TuiCommand.MoveSelectionPageUp, TuiCommand.MoveSelectionPageDown, TuiCommand.StepSelectionTowardsNow, TuiCommand.StepSelectionTowardsEarliest, TuiCommand.StepAllTowardsNow, TuiCommand.StepAllTowardsEarliest];
const SELECTION_COMMANDS = [TuiCommand.ToggleSelection, TuiCommand.ExtendSelection, TuiCommand.ResetSelectedStores, TuiCommand.ResetAllStores];
const SPEED_COMMANDS = [TuiCommand.SetEventSpeed, TuiCommand.ToggleDaySpeed, TuiCommand.ToggleWeekSpeed];
const ACTION_COMMANDS = [TuiCommand.ViewFile, TuiCommand.ReconstructUntilEarliest, TuiCommand.OpenConsole, TuiCommand.PlayScript];

function buildItems(keyBox: KeyBoxSettings, commands: TuiCommand[], showsKeyLabel: boolean, disabledCommands: TuiCommand[]): HotKeyItem[] {
    const entries = Object.values(keyBox.keys);
    return commands.map((command) => {
        const entry = entries.find((candidate) => candidate.action === command)!;
        return { keyLabel: showsKeyLabel ? formatKeyBinding(entry) : undefined, text: entry.text, keyColor: entry.customColor ?? keyBox.defaultKeyColor, isDisabled: disabledCommands.includes(command) };
    });
}

function buildKeyRow(keyBox: KeyBoxSettings, name: string, commands: TuiCommand[], disabledCommands: TuiCommand[]): HotKeyRow {
    return { name, itemSeparator: ", ", items: buildItems(keyBox, commands, true, disabledCommands), warningText: undefined, rightText: undefined };
}

export function buildHotKeyRows(keyBox: KeyBoxSettings, speed: JumpSpeed, disabledCommands: TuiCommand[] = []): HotKeyRow[] {
    // const isDayOrWeek = speed !== JumpSpeed.Event;
    return [
        // { name: "Navigation", itemSeparator: "  ", items: buildItems(keyBox, NAVIGATION_COMMANDS, false, disabledCommands), warningText: isDayOrWeek ? DAY_OR_WEEK_WARNING_TEXT : undefined, rightText: undefined },
        { name: "Navigation", itemSeparator: "  ", items: buildItems(keyBox, NAVIGATION_COMMANDS, false, disabledCommands), warningText: undefined, rightText: undefined },
        buildKeyRow(keyBox, "selection", SELECTION_COMMANDS, disabledCommands),
        { ...buildKeyRow(keyBox, "Speed", SPEED_COMMANDS, disabledCommands), rightText: `Current: ${speed}` },
        { ...buildKeyRow(keyBox, "Actions", ACTION_COMMANDS, disabledCommands), itemSeparator: "  " },
    ];
}

export function buildFileViewHotKeyRows(keyBox: KeyBoxSettings, disabledCommands: TuiCommand[]): HotKeyRow[] {
    return [
        buildKeyRow(keyBox, "View file", [TuiCommand.ScrollUp, TuiCommand.ScrollDown, TuiCommand.ToggleDiffView, TuiCommand.CloseBox], disabledCommands),
        buildKeyRow(keyBox, "Marker", [TuiCommand.ViewFileStepTowardsEarliest, TuiCommand.ViewFileStepTowardsNow, TuiCommand.ToggleDaySpeed, TuiCommand.ToggleWeekSpeed], disabledCommands),
    ];
}

export function buildConsoleHotKeyRows(keyBox: KeyBoxSettings, disabledCommands: TuiCommand[]): HotKeyRow[] {
    return [buildKeyRow(keyBox, "Console", [TuiCommand.ScrollUp, TuiCommand.ScrollDown, TuiCommand.CloseBox, TuiCommand.OpenLogFolder], disabledCommands)];
}

export function formatHotKeyItemText(item: HotKeyItem): string {
    return item.keyLabel === undefined ? item.text : `${item.keyLabel}: ${item.text}`;
}

export function formatHotKeyRowText(row: HotKeyRow): string {
    const itemsText = row.items.map(formatHotKeyItemText).join(row.itemSeparator);
    return row.warningText === undefined ? `${row.name}: ${itemsText}` : `${row.name}: ${itemsText}  ${row.warningText}`;
}

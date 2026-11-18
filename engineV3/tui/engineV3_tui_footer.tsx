// The TUI footer: a details box for the selected bar and a key command box, both drawn with round borders.
import { Box, Text } from "ink";
import { JumpSpeed, TuiCommand } from "../../src/structures/vocabulary.ts";
import { formatKeyBinding, type Keymap } from "./engineV3_tui_keymap.ts";

export type FooterEntry = { label: string; value: string; labelColor?: string };

export const LABEL_COLOR = "cyan";
export const VALUE_COLOR = "green";
const DETAILS_BORDER_COLOR = "blue";
const KEYS_BORDER_COLOR = "gray";
const ENTRY_GAP_COLUMNS = 2;
const LABEL_VALUE_SEPARATOR = ": ";
// the border takes one column on each side, the padding one more on each side
const BOX_SIDE_COLUMNS = 4;
const BOX_BORDER_ROWS = 2;

const ACTION_TEXT_BY_COMMAND: Record<TuiCommand, string> = {
    [TuiCommand.MoveSelectionUp]: "up",
    [TuiCommand.MoveSelectionDown]: "down",
    [TuiCommand.ToggleSelection]: "(de)select",
    [TuiCommand.ExtendSelection]: "select multiple",
    [TuiCommand.ResetSelectedStores]: "reset selected store",
    [TuiCommand.ResetAllStores]: "reset all stores",
    [TuiCommand.StepSelectionTowardsNow]: "selected towards now",
    [TuiCommand.StepSelectionTowardsEarliest]: "towards older",
    [TuiCommand.StepAllTowardsNow]: "all towards now",
    [TuiCommand.StepAllTowardsEarliest]: "all towardsolder",
    [TuiCommand.ToggleDaySpeed]: "step by 1 day",
    [TuiCommand.ToggleWeekSpeed]: "step by 1 week",
    [TuiCommand.PlayScript]: "play script",
};

function getEntryWidth(entry: FooterEntry): number {
    return entry.label.length + LABEL_VALUE_SEPARATOR.length + entry.value.length;
}

export function layoutEntriesIntoLines(entries: FooterEntry[], lineWidth: number): FooterEntry[][] {
    const lines: FooterEntry[][] = [];
    let currentLine: FooterEntry[] = [];
    let currentWidth = 0;
    for (const entry of entries) {
        const widthWithGap = currentLine.length === 0 ? getEntryWidth(entry) : currentWidth + ENTRY_GAP_COLUMNS + getEntryWidth(entry);
        if (currentLine.length > 0) {
            if (widthWithGap > lineWidth) {
                lines.push(currentLine);
                currentLine = [];
                currentWidth = 0;
            }
        }
        currentWidth = currentLine.length === 0 ? getEntryWidth(entry) : currentWidth + ENTRY_GAP_COLUMNS + getEntryWidth(entry);
        currentLine.push(entry);
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }
    return lines;
}

export function buildKeyFooterEntries(keymap: Keymap, speed: JumpSpeed): FooterEntry[] {
    const entries: FooterEntry[] = [];
    for (const command of Object.values(TuiCommand)) {
        entries.push({ label: formatKeyBinding(keymap.get(command)!), value: ACTION_TEXT_BY_COMMAND[command] });
    }
    entries.push({ label: "speed", value: speed });
    return entries;
}

// The number of terminal rows a box with these entries takes: the text lines plus the two border rows.
export function countBoxRows(entries: FooterEntry[], columns: number): number {
    return layoutEntriesIntoLines(entries, columns - BOX_SIDE_COLUMNS).length + BOX_BORDER_ROWS;
}

// The number of terminal rows a box with these fixed lines takes.
export function countLinesBoxRows(lines: FooterEntry[][]): number {
    return lines.length + BOX_BORDER_ROWS;
}

function EntryBox({ entries, columns, borderColor }: { entries: FooterEntry[]; columns: number; borderColor: string }) {
    return <LinesBox lines={layoutEntriesIntoLines(entries, columns - BOX_SIDE_COLUMNS)} columns={columns} borderColor={borderColor} />;
}

function LinesBox({ lines, columns, borderColor }: { lines: FooterEntry[][]; columns: number; borderColor: string }) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1} width={columns}>
            {lines.map((line, lineIndex) => (
                <Box key={lineIndex} gap={ENTRY_GAP_COLUMNS}>
                    {line.map((entry) => (
                        <Text key={`${entry.label}${entry.value}`} wrap="truncate-end">
                            <Text color={entry.labelColor ?? LABEL_COLOR}>{entry.label}</Text>
                            {LABEL_VALUE_SEPARATOR}
                            <Text color={VALUE_COLOR}>{entry.value}</Text>
                        </Text>
                    ))}
                </Box>
            ))}
        </Box>
    );
}

export function DetailsBox({ entries, columns }: { entries: FooterEntry[]; columns: number }) {
    return <EntryBox entries={entries} columns={columns} borderColor={DETAILS_BORDER_COLOR} />;
}

export function LegendBox({ lines, columns }: { lines: FooterEntry[][]; columns: number }) {
    return <LinesBox lines={lines} columns={columns} borderColor={KEYS_BORDER_COLOR} />;
}

export function KeyFooter({ entries, columns }: { entries: FooterEntry[]; columns: number }) {
    return <EntryBox entries={entries} columns={columns} borderColor={KEYS_BORDER_COLOR} />;
}

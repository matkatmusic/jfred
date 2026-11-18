// The hotkeys box: one line for each named row, the current speed at the right edge of its row.

import { Box, Text } from "ink";
import { TUI_COLORS } from "./engineV3_tui_colors.ts";
import type { HotKeyRow } from "./engineV3_tui_hotkeys_rows.ts";
import type { KeyBoxSettings } from "./engineV3_tui_keymap.ts";
import { TitledBox } from "./engineV3_tui_titled_box.tsx";

export const HOTKEYS_BOX_ROW_COUNT = 6;
const BORDER_ROW_COUNT = 2;

export function countHotKeysBoxRows(rows: HotKeyRow[]): number {
    return rows.length + BORDER_ROW_COUNT;
}

export function HotKeysBox({ rows, keyBox, columns }: { rows: HotKeyRow[]; keyBox: KeyBoxSettings; columns: number }) {
    return (
        // <Box flexDirection="column" borderStyle="round" borderColor={keyBox.borderColor} paddingX={1} width={columns}>
        <TitledBox title="Hotkeys" flexDirection="column" borderColor={keyBox.borderColor} paddingX={1} columns={columns}>
            {rows.map((row) => (
                <Box key={row.name} justifyContent="space-between">
                    <Text wrap="truncate-end">
                        <Text color={keyBox.defaultLabelColor}>{row.name}: </Text>
                        {row.items.map((item, index) => (
                            <Text key={item.text} dimColor={item.isDisabled}>
                                {index > 0 ? row.itemSeparator : ""}
                                {item.keyLabel === undefined ? null : <Text color={item.keyColor}>{item.keyLabel}: </Text>}
                                <Text color={TUI_COLORS.infoBox.valueColor}>{item.text}</Text>
                            </Text>
                        ))}
                        {row.warningText === undefined ? null : <Text color={TUI_COLORS.markerBox.markedColor}>{`  ${row.warningText}`}</Text>}
                    </Text>
                    {row.rightText === undefined ? null : <Text color={TUI_COLORS.infoBox.valueColor}>{row.rightText}</Text>}
                </Box>
            ))}
        </TitledBox>
    );
}

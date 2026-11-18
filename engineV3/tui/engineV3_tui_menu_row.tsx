// The menu row of the terminal UI: every key binding, then the jump speed.

import { Text } from "ink";
import { JumpSpeed, TuiCommand } from "../../src/structures/vocabulary.ts";
import { formatKeyBinding, type Keymap } from "./engineV3_tui_keymap.ts";

export function formatMenuRowText(keymap: Keymap, speed: JumpSpeed): string {
    const bindingTexts: string[] = [];
    for (const command of Object.values(TuiCommand)) {
        bindingTexts.push(formatKeyBinding(keymap.get(command)!));
    }
    return `${bindingTexts.join("  ")}  speed: ${speed}`;
}

export function MenuRow({ keymap, speed }: { keymap: Keymap; speed: JumpSpeed }) {
    return <Text>{formatMenuRowText(keymap, speed)}</Text>;
}

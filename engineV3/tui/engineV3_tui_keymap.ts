// The terminal UI keymap: keys come from a JSON file and map to TuiCommand values.

import { readFileSync } from "node:fs";
import type { Key } from "ink";
import type { Path } from "../../src/structures/domain.ts";
import { TuiCommand } from "../../src/structures/vocabulary.ts";

export const INK_KEY_NAMES = ["upArrow", "downArrow", "leftArrow", "rightArrow", "pageDown", "pageUp", "home", "end", "return", "escape", "tab", "backspace", "delete"] as const;
export type KeyBinding = { input?: string; key?: (typeof INK_KEY_NAMES)[number]; shift?: boolean };
export type Keymap = Map<TuiCommand, KeyBinding>;

const KEY_DISPLAY_NAMES: Record<(typeof INK_KEY_NAMES)[number], string> = {
    upArrow: "Up",
    downArrow: "Down",
    leftArrow: "Left",
    rightArrow: "Right",
    pageDown: "PageDown",
    pageUp: "PageUp",
    home: "Home",
    end: "End",
    return: "Enter",
    escape: "Esc",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
};

function validateKeyBinding(commandName: string, binding: KeyBinding): void {
    const hasInput = binding.input !== undefined;
    const hasKey = binding.key !== undefined;
    if (hasInput === hasKey) {
        throw new Error(`keymap entry ${commandName} must have exactly one of input or key`);
    }
    if (hasKey) {
        if (!(INK_KEY_NAMES as readonly string[]).includes(binding.key as string)) {
            throw new Error(`keymap entry ${commandName} has unknown key ${binding.key}`);
        }
    }
    if (hasInput) {
        if (binding.shift !== undefined) {
            throw new Error(`keymap entry ${commandName} has shift with input; shift is only for key`);
        }
    }
}

function buildBindingSignature(binding: KeyBinding): string {
    return JSON.stringify([binding.input ?? null, binding.key ?? null, binding.shift ?? false]);
}

export function loadKeymap(keymapFile: Path): Keymap {
    const keymapEntries: Record<string, KeyBinding> = JSON.parse(readFileSync(keymapFile.value, "utf8"));
    const validCommands: string[] = Object.values(TuiCommand);
    const keymap: Keymap = new Map();
    const commandNameBySignature = new Map<string, string>();
    for (const [commandName, binding] of Object.entries(keymapEntries)) {
        if (!validCommands.includes(commandName)) {
            throw new Error(`keymap entry ${commandName} is not a TuiCommand`);
        }
        validateKeyBinding(commandName, binding);
        const signature = buildBindingSignature(binding);
        const otherCommandName = commandNameBySignature.get(signature);
        if (otherCommandName !== undefined) {
            throw new Error(`keymap commands ${otherCommandName} and ${commandName} have the same binding`);
        }
        commandNameBySignature.set(signature, commandName);
        keymap.set(commandName as TuiCommand, binding);
    }
    for (const command of Object.values(TuiCommand)) {
        if (!keymap.has(command)) {
            throw new Error(`keymap has no entry for ${command}`);
        }
    }
    return keymap;
}

export function findCommandForKey(keymap: Keymap, input: string, key: Key): TuiCommand | undefined {
    for (const [command, binding] of keymap) {
        if (binding.input !== undefined) {
            if (binding.input === input) {
                return command;
            }
        }
        if (binding.key !== undefined) {
            if (key[binding.key] === true) {
                if (key.shift === (binding.shift ?? false)) {
                    return command;
                }
            }
        }
    }
    return undefined;
}

export function formatKeyBinding(binding: KeyBinding): string {
    if (binding.key === undefined) {
        return binding.input as string;
    }
    const keyDisplayName = KEY_DISPLAY_NAMES[binding.key];
    if (binding.shift === true) {
        return `Shift-${keyDisplayName}`;
    }
    return keyDisplayName;
}

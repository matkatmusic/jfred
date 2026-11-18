// The terminal UI keymap: keys come from a JSON file and map to TuiCommand values.

import { readFileSync } from "node:fs";
import type { Key } from "ink";
import type { Path } from "../../src/structures/domain.ts";
import { TuiCommand } from "../../src/structures/vocabulary.ts";

export const INK_KEY_NAMES = ["upArrow", "downArrow", "leftArrow", "rightArrow", "pageDown", "pageUp", "home", "end", "return", "escape", "tab", "backspace", "delete"] as const;
export type KeyBinding = { input?: string; key?: (typeof INK_KEY_NAMES)[number]; shift?: boolean };
export type Keymap = Map<TuiCommand, KeyBinding>;

// The name of a box in keymap.json that has keys.
export enum KeyBox {
    Global = "globalHotKeysBox",
    FileView = "fileViewHotKeysBox",
    Console = "consoleHotKeysBox",
}
export type KeyEntry = KeyBinding & { action: TuiCommand; text: string; customColor: string | null };
export type KeyBoxSettings = { defaultKeyColor: string; defaultLabelColor: string; borderColor: string; keys: Record<string, KeyEntry> };

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

// The same binding may repeat in two boxes, never inside one box.
export function loadKeyBox(keymapFile: Path, box: KeyBox): KeyBoxSettings {
    const keyBox: KeyBoxSettings = JSON.parse(readFileSync(keymapFile.value, "utf8"))[box];
    const validCommands: string[] = Object.values(TuiCommand);
    const keyIdBySignature = new Map<string, string>();
    for (const [keyId, entry] of Object.entries(keyBox.keys)) {
        if (!validCommands.includes(entry.action)) {
            throw new Error(`keymap entry ${box}.${keyId} is not a TuiCommand: ${entry.action}`);
        }
        validateKeyBinding(`${box}.${keyId}`, entry);
        const signature = buildBindingSignature(entry);
        const otherKeyId = keyIdBySignature.get(signature);
        if (otherKeyId !== undefined) {
            throw new Error(`keymap keys ${otherKeyId} and ${keyId} of ${box} have the same binding`);
        }
        keyIdBySignature.set(signature, keyId);
    }
    return keyBox;
}

export function loadKeyBoxes(keymapFile: Path): Record<KeyBox, KeyBoxSettings> {
    return Object.fromEntries(Object.values(KeyBox).map((box) => [box, loadKeyBox(keymapFile, box)])) as Record<KeyBox, KeyBoxSettings>;
}

function buildBindingOfEntry(entry: KeyEntry): KeyBinding {
    const binding: KeyBinding = {};
    if (entry.input !== undefined) {
        binding.input = entry.input;
    }
    if (entry.key !== undefined) {
        binding.key = entry.key;
    }
    if (entry.shift !== undefined) {
        binding.shift = entry.shift;
    }
    return binding;
}

// Every TuiCommand must have a key in at least one box.
export function loadKeymap(keymapFile: Path, box: KeyBox = KeyBox.Global): Keymap {
    const boundCommands = new Set<TuiCommand>();
    for (const boxToCheck of Object.values(KeyBox)) {
        for (const entry of Object.values(loadKeyBox(keymapFile, boxToCheck).keys)) {
            boundCommands.add(entry.action);
        }
    }
    for (const command of Object.values(TuiCommand)) {
        if (!boundCommands.has(command)) {
            throw new Error(`keymap has no entry for ${command}`);
        }
    }
    return buildKeymapOfKeyBox(loadKeyBox(keymapFile, box));
}

export function buildKeymapOfKeyBox(keyBox: KeyBoxSettings): Keymap {
    const keymap: Keymap = new Map();
    for (const entry of Object.values(keyBox.keys)) {
        keymap.set(entry.action, buildBindingOfEntry(entry));
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

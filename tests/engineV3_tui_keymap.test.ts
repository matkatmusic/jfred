// Tests of the terminal UI keymap: keys come from a JSON file and map to TuiCommand values.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { Key } from "ink";
import { Path } from "../src/structures/domain.ts";
import { TuiCommand } from "../src/structures/vocabulary.ts";
import { findCommandForKey, formatKeyBinding, loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";

const DEFAULT_KEYMAP_FILE = new Path(join(dirname(fileURLToPath(import.meta.url)), "..", "engineV3", "tui", "keymap.json"));

const VALID_KEYMAP: Record<string, unknown> = {
    moveSelectionUp: { key: "upArrow" },
    moveSelectionDown: { key: "downArrow" },
    toggleSelection: { input: "s" },
    extendSelection: { input: "S" },
    resetSelectedStores: { input: "r" },
    resetAllStores: { input: "R" },
    stepSelectionTowardsNow: { key: "leftArrow" },
    stepSelectionTowardsEarliest: { key: "rightArrow" },
    stepAllTowardsNow: { key: "leftArrow", shift: true },
    stepAllTowardsEarliest: { key: "rightArrow", shift: true },
    toggleDaySpeed: { input: "d" },
    toggleWeekSpeed: { input: "w" },
    playScript: { input: "p" },
};

// An override value of undefined removes that command from the file.
function writeKeymapFile(t: TestContext, overrides: Record<string, unknown>): Path {
    const keymapFolder = mkdtempSync(join(tmpdir(), "engineV3-tui-keymap-"));
    t.after(() => rmSync(keymapFolder, { recursive: true, force: true }));
    const keymapContent: Record<string, unknown> = { ...VALID_KEYMAP };
    for (const [commandName, binding] of Object.entries(overrides)) {
        if (binding === undefined) {
            delete keymapContent[commandName];
        } else {
            keymapContent[commandName] = binding;
        }
    }
    const keymapFile = join(keymapFolder, "keymap.json");
    writeFileSync(keymapFile, JSON.stringify(keymapContent, null, 4));
    return new Path(keymapFile);
}

function makeKey(overrides: Partial<Key>): Key {
    const allKeysOff: Key = {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        pageDown: false,
        pageUp: false,
        home: false,
        end: false,
        return: false,
        escape: false,
        ctrl: false,
        shift: false,
        tab: false,
        backspace: false,
        delete: false,
        meta: false,
        super: false,
        hyper: false,
        capsLock: false,
        numLock: false,
    };
    return { ...allKeysOff, ...overrides };
}

test("test_loadKeymap_reads_the_default_file", () => {
    // Load the committed default keymap file.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE);
    // Every TuiCommand has a binding.
    for (const command of Object.values(TuiCommand)) {
        assert.ok(keymap.has(command), `no binding for ${command}`);
    }
    // The day and week speed commands are bound.
    assert.deepEqual(keymap.get(TuiCommand.ToggleDaySpeed), { input: "d" });
    assert.deepEqual(keymap.get(TuiCommand.ToggleWeekSpeed), { input: "w" });
});

test("test_loadKeymap_throws_on_a_missing_command", (t) => {
    // Write a keymap file with no entry for playScript.
    const keymapFile = writeKeymapFile(t, { playScript: undefined });
    // Loading the file throws.
    assert.throws(() => loadKeymap(keymapFile));
});

test("test_loadKeymap_throws_on_two_commands_with_one_key", (t) => {
    // Write a keymap file where toggleWeekSpeed uses the same input as toggleDaySpeed.
    const keymapFile = writeKeymapFile(t, { toggleWeekSpeed: { input: "d" } });
    // Loading the file throws.
    assert.throws(() => loadKeymap(keymapFile));
});

test("test_loadKeymap_throws_on_an_entry_with_input_and_key", (t) => {
    // Write a keymap file where toggleDaySpeed has both an input and a key.
    const keymapFile = writeKeymapFile(t, { toggleDaySpeed: { input: "d", key: "tab" } });
    // Loading the file throws.
    assert.throws(() => loadKeymap(keymapFile));
});

test("test_loadKeymap_throws_on_a_missing_file", () => {
    // Point at a keymap file that does not exist.
    const missingKeymapFile = new Path(join(tmpdir(), "engineV3-tui-keymap-no-such-folder", "keymap.json"));
    // Loading the file throws.
    assert.throws(() => loadKeymap(missingKeymapFile));
});

test("test_findCommandForKey_tells_left_from_shift_left", () => {
    // Load the default keymap.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE);
    // The left arrow without shift finds the selection step command.
    assert.equal(findCommandForKey(keymap, "", makeKey({ leftArrow: true })), TuiCommand.StepSelectionTowardsNow);
    // The left arrow with shift finds the step-all command.
    assert.equal(findCommandForKey(keymap, "", makeKey({ leftArrow: true, shift: true })), TuiCommand.StepAllTowardsNow);
});

test("test_findCommandForKey_matches_an_uppercase_letter_by_input", () => {
    // Load the default keymap.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE);
    // Ink sets shift for an uppercase letter; the input "S" still finds extendSelection.
    assert.equal(findCommandForKey(keymap, "S", makeKey({ shift: true })), TuiCommand.ExtendSelection);
    // The lowercase input "s" finds toggleSelection.
    assert.equal(findCommandForKey(keymap, "s", makeKey({})), TuiCommand.ToggleSelection);
});

test("test_findCommandForKey_returns_undefined_for_an_unbound_key", () => {
    // Load the default keymap.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE);
    // A letter with no binding finds no command.
    assert.equal(findCommandForKey(keymap, "z", makeKey({})), undefined);
    // A named key with no binding finds no command.
    assert.equal(findCommandForKey(keymap, "", makeKey({ pageUp: true })), undefined);
});

test("test_findCommandForKey_finds_the_day_and_week_speed_commands", () => {
    // Load the default keymap.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE);
    // The input "d" finds the day speed command.
    assert.equal(findCommandForKey(keymap, "d", makeKey({})), TuiCommand.ToggleDaySpeed);
    // The input "w" finds the week speed command.
    assert.equal(findCommandForKey(keymap, "w", makeKey({})), TuiCommand.ToggleWeekSpeed);
});

test("test_formatKeyBinding_shows_shift_left", () => {
    // The Shift-Left binding shows as "Shift-Left".
    assert.equal(formatKeyBinding({ key: "leftArrow", shift: true }), "Shift-Left");
    // A letter binding shows as the letter.
    assert.equal(formatKeyBinding({ input: "s" }), "s");
    assert.equal(formatKeyBinding({ input: "S" }), "S");
});

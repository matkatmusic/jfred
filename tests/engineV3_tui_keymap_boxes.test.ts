// Tests of the keymap file with one object per box: a binding may repeat across boxes, never inside one box.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Key } from "ink";
import { Path } from "../src/structures/domain.ts";
import { TuiCommand } from "../src/structures/vocabulary.ts";
import { KeyBox, findCommandForKey, loadKeyBox, loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";

const DEFAULT_KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));

function writeChangedKeymapFile(t: TestContext, changeContent: (content: Record<string, any>) => void): Path {
    const keymapFolder = mkdtempSync(join(tmpdir(), "engineV3-tui-keymap-boxes-"));
    t.after(() => rmSync(keymapFolder, { recursive: true, force: true }));
    const content = JSON.parse(readFileSync(DEFAULT_KEYMAP_FILE.value, "utf8"));
    changeContent(content);
    const keymapFile = join(keymapFolder, "keymap.json");
    writeFileSync(keymapFile, JSON.stringify(content, null, 4));
    return new Path(keymapFile);
}

function makeKeyWithNothingPressed(): Key {
    return { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false };
}

test("test_the_same_binding_in_two_boxes_is_allowed", () => {
    // Scenario: key c opens the console in the global box and closes the box in the console box.
    // load the global box and the console box of the default file.
    const globalKeymap = loadKeymap(DEFAULT_KEYMAP_FILE, KeyBox.Global);
    const consoleKeymap = loadKeymap(DEFAULT_KEYMAP_FILE, KeyBox.Console);
    // both bind the input c, each to its own command.
    assert.deepEqual(globalKeymap.get(TuiCommand.OpenConsole), { input: "c" });
    assert.deepEqual(consoleKeymap.get(TuiCommand.CloseBox), { input: "c" });
});

test("test_the_same_binding_twice_in_one_box_throws", (t) => {
    // Scenario: the console box gets a second key with the input c.
    const keymapFile = writeChangedKeymapFile(t, (content) => {
        content.consoleHotKeysBox.keys.second = { action: "openLogFolder", input: "c", text: "again", customColor: null };
    });
    // loading the file throws.
    assert.throws(() => loadKeymap(keymapFile, KeyBox.Console), /same binding/);
});

test("test_an_action_that_is_not_a_command_throws", (t) => {
    // Scenario: a key names the action fly.
    const keymapFile = writeChangedKeymapFile(t, (content) => {
        content.globalHotKeysBox.keys.up.action = "fly";
    });
    // loading the file throws.
    assert.throws(() => loadKeymap(keymapFile), /not a TuiCommand/);
});

test("test_a_key_box_gives_its_default_key_color_and_the_text_of_a_key", () => {
    // Scenario: the global box of the default file.
    const keyBox = loadKeyBox(DEFAULT_KEYMAP_FILE, KeyBox.Global);
    // the default key color is light grey.
    assert.equal(keyBox.defaultKeyColor, "#c0c0c0");
    // the event speed key shows its text; a key without custom color has customColor null.
    assert.equal(keyBox.keys["eventSpeed"]!.text, "1 event");
    assert.equal(keyBox.keys["eventSpeed"]!.customColor, null);
});

test("test_key_e_is_bound_to_the_event_speed_command", () => {
    // Scenario: the input e in the global box.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE, KeyBox.Global);
    // it finds the event speed command.
    assert.equal(findCommandForKey(keymap, "e", makeKeyWithNothingPressed()), TuiCommand.SetEventSpeed);
});

test("test_the_up_arrow_scrolls_in_the_file_view_box", () => {
    // Scenario: the up arrow in the file view box.
    const keymap = loadKeymap(DEFAULT_KEYMAP_FILE, KeyBox.FileView);
    // it finds the scroll up command.
    assert.equal(findCommandForKey(keymap, "", { ...makeKeyWithNothingPressed(), upArrow: true }), TuiCommand.ScrollUp);
});

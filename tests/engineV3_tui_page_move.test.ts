// Option+Up and Option+Down move the cursor and the first visible row by one page.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Key } from "ink";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { TuiCommand } from "../src/structures/vocabulary.ts";
import { findCommandForKey, loadKeymap } from "../engineV3/tui/engineV3_tui_keymap.ts";
import { computePageMove } from "../engineV3/tui/engineV3_tui_viewport.ts";

const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));

function makeKey(overrides: Partial<Key>): Key {
    return { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false, home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false, backspace: false, delete: false, meta: false, ...overrides } as Key;
}

test("test_a_page_down_moves_the_cursor_and_the_top_by_one_page", () => {
    // Scenario: 100 rows, a page of 10 rows, the cursor on row 3 of the first page.
    const move = computePageMove({ rowCount: 100, cursorIndex: 3, top: 0, pageRowCount: 10, direction: 1 });
    // the cursor keeps its place on the screen: row 13 of the list, top row 10.
    assert.deepEqual(move, { cursorIndex: 13, top: 10 });
});

test("test_a_page_up_moves_the_cursor_and_the_top_back_by_one_page", () => {
    // Scenario: the cursor is on row 13 and the top row is 10.
    const move = computePageMove({ rowCount: 100, cursorIndex: 13, top: 10, pageRowCount: 10, direction: -1 });
    assert.deepEqual(move, { cursorIndex: 3, top: 0 });
});

test("test_a_page_down_near_the_last_row_stops_at_the_last_row", () => {
    // Scenario: 25 rows, a page of 10, the cursor on row 18 and the top row 10.
    const move = computePageMove({ rowCount: 25, cursorIndex: 18, top: 10, pageRowCount: 10, direction: 1 });
    // the cursor stops at the last row 24; the top row stops at 15 so the last page is full.
    assert.deepEqual(move, { cursorIndex: 24, top: 15 });
});

test("test_a_page_up_near_the_first_row_stops_at_the_first_row", () => {
    // Scenario: the cursor is on row 2 and the top row is 0.
    const move = computePageMove({ rowCount: 100, cursorIndex: 2, top: 0, pageRowCount: 10, direction: -1 });
    assert.deepEqual(move, { cursorIndex: 0, top: 0 });
});

test("test_option_up_and_option_down_are_the_page_commands_and_plain_up_and_down_stay_single_row", () => {
    // Scenario: the keymap file is loaded.
    const keymap = loadKeymap(KEYMAP_FILE);
    // option (Ink reports it as meta) with the arrows picks the page commands.
    assert.equal(findCommandForKey(keymap, "", makeKey({ upArrow: true, meta: true })), TuiCommand.MoveSelectionPageUp);
    assert.equal(findCommandForKey(keymap, "", makeKey({ downArrow: true, meta: true })), TuiCommand.MoveSelectionPageDown);
    // the arrows alone still move one row.
    assert.equal(findCommandForKey(keymap, "", makeKey({ upArrow: true })), TuiCommand.MoveSelectionUp);
    assert.equal(findCommandForKey(keymap, "", makeKey({ downArrow: true })), TuiCommand.MoveSelectionDown);
});

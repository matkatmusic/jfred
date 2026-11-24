// Tests of the hotkeys rows of the View File box and the Engine Console box, and of disabled keys.

process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { Path } from "../src/structures/domain.ts";
import { JumpSpeed, TuiCommand } from "../src/structures/vocabulary.ts";
import { KeyBox, loadKeyBox } from "../engineV3/tui/engineV3_tui_keymap.ts";
import { buildConsoleHotKeyRows, buildFileViewHotKeyRows, buildHotKeyRows, formatHotKeyRowText } from "../engineV3/tui/engineV3_tui_hotkeys_rows.ts";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink-testing-library");
const { HotKeysBox } = await import("../engineV3/tui/engineV3_tui_hotkeys_box.tsx");

const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));
const DIM_START = "\x1b[2m";

test("test_the_file_view_rows_name_only_the_nine_file_view_keys", () => {
    // Scenario: the rows of the file view box.
    const rows = buildFileViewHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.FileView), []);
    // two rows hold the scroll keys, diff, close and quit, then the marker keys.
    // assert.equal(formatHotKeyRowText(rows[0]!), "View file: Up: scroll up, Down: scroll down, f: diff, c: close");
    assert.equal(formatHotKeyRowText(rows[0]!), "View file: Up: scroll up, Down: scroll down, f: diff, c: close, q: quit");
    assert.equal(formatHotKeyRowText(rows[1]!), "Marker: Right: towards earlier, Left: towards Now, d: step by 1 day, w: step by 1 week");
    assert.equal(rows.length, 2);
});

test("test_the_console_row_names_scroll_close_open_log_folder_and_quit", () => {
    // Scenario: the rows of the console box.
    const rows = buildConsoleHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Console), []);
    // one row.
    assert.equal(rows.length, 1);
    // assert.equal(formatHotKeyRowText(rows[0]!), "Console: Up: scroll up, Down: scroll down, c: close, o: open log folder");
    assert.equal(formatHotKeyRowText(rows[0]!), "Console: Up: scroll up, Down: scroll down, c: close, o: open log folder, q: quit");
});

test("test_only_the_listed_commands_are_disabled", () => {
    // Scenario: the global rows with the view file command disabled.
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event, [TuiCommand.ViewFile]);
    // the View file item is disabled and the (de)select item is not.
    const items = rows.flatMap((row) => row.items);
    assert.equal(items.find((item) => item.text === "View file")!.isDisabled, true);
    assert.equal(items.find((item) => item.text === "(de)select")!.isDisabled, false);
});

test("test_a_disabled_key_is_drawn_dim_and_an_enabled_key_is_not", () => {
    // Scenario: the console row with the open log folder key disabled, then with none disabled.
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Console);
    const disabledFrame = render(createElement(HotKeysBox, { rows: buildConsoleHotKeyRows(keyBox, [TuiCommand.OpenLogFolder]), keyBox, columns: 100 })).lastFrame()!;
    const enabledFrame = render(createElement(HotKeysBox, { rows: buildConsoleHotKeyRows(keyBox, []), keyBox, columns: 100 })).lastFrame()!;
    // only the first frame holds the dim code.
    assert.ok(disabledFrame.includes(DIM_START));
    assert.ok(!enabledFrame.includes(DIM_START));
});

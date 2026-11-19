// Tests of the hotkeys box: four named rows built from the global box of keymap.json.

process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { Path } from "../src/structures/domain.ts";
import { JumpSpeed } from "../src/structures/vocabulary.ts";
import { KeyBox, loadKeyBox } from "../engineV3/tui/engineV3_tui_keymap.ts";
import { buildHotKeyRows, formatHotKeyRowText } from "../engineV3/tui/engineV3_tui_hotkeys_rows.ts";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink-testing-library");
const { HotKeysBox } = await import("../engineV3/tui/engineV3_tui_hotkeys_box.tsx");

const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));
const COLOR_CODE_PATTERN = /\x1b\[[0-9;]*m/g;
const LIGHT_GREY_START = "\x1b[38;2;192;192;192m";

function drawBox(speed: JumpSpeed, columns: number = 100): string[] {
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Global);
    const { lastFrame } = render(createElement(HotKeysBox, { rows: buildHotKeyRows(keyBox, speed), keyBox, columns }));
    return lastFrame()!.split("\n");
}

test("test_the_navigation_row_names_the_six_navigation_keys_with_what_each_does", () => {
    // Scenario: event speed.
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event);
    // the first row is the Navigation row with the exact text.
    assert.equal(formatHotKeyRowText(rows[0]!), "Navigation: Up: prev row  Down: next row  Option+Up: prev page  Option+Down: next page  Left: selected row towards newer  Right: selected row towards older");
});

test("test_the_left_and_right_texts_say_step_all_rows_when_the_marker_scope_is_on", () => {
    // Scenario: event speed with the Marker Box showing all files.
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event, [], true);
    // Left and Right now step all rows; the other four keys keep their text.
    assert.equal(formatHotKeyRowText(rows[0]!), "Navigation: Up: prev row  Down: next row  Option+Up: prev page  Option+Down: next page  Left: step all rows towards newer  Right: step all rows towards older");
});

test("test_the_navigation_key_labels_have_the_same_key_color_as_the_other_rows", () => {
    // Scenario: the rows at event speed.
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Global);
    const rows = buildHotKeyRows(keyBox, JumpSpeed.Event);
    // every Navigation item has its key as a label, in the same color as the "s" key of the selection row.
    const selectKeyColor = rows[1]!.items[0]!.keyColor;
    for (const item of rows[0]!.items) {
        assert.notEqual(item.keyLabel, undefined, item.text);
        assert.equal(item.keyColor, selectKeyColor);
    }
    // the drawn Navigation row has the Up label in the light grey code.
    const frame = drawBox(JumpSpeed.Event).join("\n");
    assert.ok(frame.includes(`${LIGHT_GREY_START}Up:`));
});

test("test_the_selection_row_has_the_four_selection_keys", () => {
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event);
    assert.equal(formatHotKeyRowText(rows[1]!), "selection: s: (de)select, S: select multiple, r: reset selected store, R: reset all stores");
});

test("test_the_speed_row_has_three_speed_keys_and_the_current_speed_on_the_right", () => {
    // Scenario: week speed. The row also names the a key, which toggles the Marker Box between the cursor file and all files.
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Week);
    // the Speed row lists e, d, w and a.
    assert.equal(formatHotKeyRowText(rows[2]!), "Speed: e: Step by 1 event, d: Step by 1 Day, w: Step by 1 week, a: Marker scope");
    // the right text names the current speed.
    assert.equal(rows[2]!.rightText, "Current: week");
});

test("test_the_actions_row_ends_with_the_play_script_key", () => {
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event);
    assert.equal(formatHotKeyRowText(rows[3]!), "Actions: v: View file  g: reconstruct file until Earliest  c: engine console  p: play script");
});

test("test_the_navigation_row_has_no_warning_at_any_speed", () => {
    // Scenario: the rows at event, day and week speed.
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Global);
    for (const speed of [JumpSpeed.Event, JumpSpeed.Day, JumpSpeed.Week]) {
        // the Navigation row has no warning text.
        assert.equal(buildHotKeyRows(keyBox, speed)[0]!.warningText, undefined);
        // the Navigation row text ends with the last key.
        assert.match(formatHotKeyRowText(buildHotKeyRows(keyBox, speed)[0]!), /Right: selected row towards older$/);
    }
});

test("test_a_key_label_has_the_default_key_color_and_a_custom_color_replaces_it", () => {
    // Scenario: the "s" key of the default file, then the same key with a custom color.
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Global);
    const selectItem = buildHotKeyRows(keyBox, JumpSpeed.Event)[1]!.items[0]!;
    // the default key color is light grey.
    assert.equal(selectItem.keyColor, "#c0c0c0");
    // a custom color replaces the default.
    keyBox.keys["select"]!.customColor = "red";
    assert.equal(buildHotKeyRows(keyBox, JumpSpeed.Event)[1]!.items[0]!.keyColor, "red");
});

test("test_the_box_draws_four_rows_in_borders_with_the_current_speed_at_the_right_edge", () => {
    // Scenario: the box at day speed in 100 columns.
    const frameLines = drawBox(JumpSpeed.Day).map((frameLine) => frameLine.replace(COLOR_CODE_PATTERN, ""));
    // 4 rows and 2 border rows.
    assert.equal(frameLines.length, 6);
    // the Speed row ends with the current speed, one padding column and the border.
    assert.match(frameLines[3]!, /Current: day │$/);
    // the Navigation row is cut at the right edge: the border stays.
    assert.match(frameLines[1]!, /^│ Navigation: Up: prev row.*│$/);
});

test("test_the_key_labels_are_drawn_in_light_grey", () => {
    // Scenario: the box at event speed.
    const frame = drawBox(JumpSpeed.Event).join("\n");
    // the label "s:" is drawn with the light grey code.
    assert.ok(frame.includes(`${LIGHT_GREY_START}s:`));
});

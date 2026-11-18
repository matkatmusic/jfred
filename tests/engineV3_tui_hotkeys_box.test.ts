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

function drawBox(speed: JumpSpeed): string[] {
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Global);
    const { lastFrame } = render(createElement(HotKeysBox, { rows: buildHotKeyRows(keyBox, speed), keyBox, columns: 100 }));
    return lastFrame()!.split("\n");
}

test("test_the_navigation_row_names_the_six_navigation_keys", () => {
    // Scenario: event speed.
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event);
    // the first row is the Navigation row with the exact text.
    assert.equal(formatHotKeyRowText(rows[0]!), "Navigation: up, down, left, right, shift-left, shift-right");
});

test("test_the_selection_row_has_the_four_selection_keys", () => {
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event);
    assert.equal(formatHotKeyRowText(rows[1]!), "selection: s: (de)select, S: select multiple, r: reset selected store, R: reset all stores");
});

test("test_the_speed_row_has_three_speed_keys_and_the_current_speed_on_the_right", () => {
    // Scenario: week speed.
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Week);
    // the Speed row lists e, d and w.
    assert.equal(formatHotKeyRowText(rows[2]!), "Speed: e: Step by 1 event, d: Step by 1 Day, w: Step by 1 week");
    // the right text names the current speed.
    assert.equal(rows[2]!.rightText, "Current: week");
});

test("test_the_actions_row_ends_with_the_play_script_key", () => {
    const rows = buildHotKeyRows(loadKeyBox(KEYMAP_FILE, KeyBox.Global), JumpSpeed.Event);
    assert.equal(formatHotKeyRowText(rows[3]!), "Actions: v: View file  g: reconstruct file until Earliest  c: engine console  p: play script");
});

test("test_day_speed_adds_a_warning_to_the_navigation_row_and_event_speed_does_not", () => {
    // Scenario: the rows at day speed and at event speed.
    const keyBox = loadKeyBox(KEYMAP_FILE, KeyBox.Global);
    // at event speed there is no warning.
    assert.equal(buildHotKeyRows(keyBox, JumpSpeed.Event)[0]!.warningText, undefined);
    // at day speed the warning names the marker box.
    assert.match(buildHotKeyRows(keyBox, JumpSpeed.Day)[0]!.warningText!, /marker box/);
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
    // the Navigation row holds the warning.
    assert.match(frameLines[1]!, /marker box/);
});

test("test_the_key_labels_are_drawn_in_light_grey", () => {
    // Scenario: the box at event speed.
    const frame = drawBox(JumpSpeed.Event).join("\n");
    // the label "s:" is drawn with the light grey code.
    assert.ok(frame.includes(`${LIGHT_GREY_START}s:`));
});

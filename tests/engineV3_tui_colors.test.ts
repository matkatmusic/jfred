// Tests that the box colors come from keymap.json.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { TUI_COLORS } from "../engineV3/tui/engineV3_tui_colors.ts";
import { HIGHLIGHT_COLOR_BY_TOKEN_CLASS } from "../engineV3/tui/engineV3_tui_file_view_text.ts";
import { KEY_LABEL_COLOR, LABEL_COLOR, VALUE_COLOR } from "../engineV3/tui/engineV3_tui_footer.tsx";
import { DOT_COLORS, UNDONE_SO_FAR_COLOR } from "../engineV3/tui/engineV3_tui_row.tsx";

const keymapContent = JSON.parse(readFileSync(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"), "utf8"));

test("test_the_colors_object_holds_the_color_boxes_of_keymap_json", () => {
    // Scenario: the color boxes of keymap.json.
    // the colors object holds the same marker box colors as the file.
    assert.deepEqual(TUI_COLORS.markerBox, keymapContent.markerBox);
    // the colors object holds the same console colors as the file.
    assert.deepEqual(TUI_COLORS.consoleBox, keymapContent.consoleBox);
    // the colors object holds the same View File colors as the file.
    assert.deepEqual(TUI_COLORS.fileViewBox, keymapContent.fileViewBox);
});

test("test_the_footer_colors_are_the_colors_of_keymap_json", () => {
    // Scenario: the footer color constants.
    // each one is the matching color of the file.
    assert.equal(LABEL_COLOR, keymapContent.legendBox.defaultTextColor);
    assert.equal(VALUE_COLOR, keymapContent.infoBox.valueColor);
    assert.equal(KEY_LABEL_COLOR, keymapContent.infoBox.defaultKeyColor);
});

test("test_the_row_colors_are_the_colors_of_keymap_json", () => {
    // Scenario: the bar row color constants.
    // the dot colors and the undone color are the colors of the file.
    assert.deepEqual(DOT_COLORS, keymapContent.barRows.dotColors);
    assert.equal(UNDONE_SO_FAR_COLOR, keymapContent.barRows.undoneSoFarColor);
});

test("test_the_syntax_token_colors_are_the_colors_of_keymap_json", () => {
    // Scenario: the highlight color map.
    // it is the token color map of the file.
    assert.deepEqual(HIGHLIGHT_COLOR_BY_TOKEN_CLASS, keymapContent.fileViewBox.tokenColors);
});

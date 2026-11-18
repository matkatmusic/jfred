// Each box of the root component names what it shows, centered in its top border.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

function hasTitleBorder(frame: string, title: string): boolean {
    return frame.split("\n").some((line) => line.startsWith("╭") && line.includes(` ${title} `));
}

test("test_the_legend_marker_info_and_hotkeys_boxes_show_their_titles", async (t) => {
    // Scenario: nothing is open.
    const screen = await startScreen(t, writeLongProject(t, true));
    const frame = screen.frame();
    // the four boxes show their titles; the two drawers are closed.
    assert.ok(hasTitleBorder(frame, "Legend"));
    assert.ok(hasTitleBorder(frame, "Marker"));
    assert.ok(hasTitleBorder(frame, "File Info"));
    assert.ok(hasTitleBorder(frame, "Hotkeys"));
    assert.ok(!hasTitleBorder(frame, "File Preview"));
    assert.ok(!hasTitleBorder(frame, "Engine Console"));
});

test("test_the_view_file_box_shows_the_title_file_preview", async (t) => {
    // Scenario: the View File box is open.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    // the title shows in the top border of the box.
    assert.ok(hasTitleBorder(screen.frame(), "File Preview"));
});

test("test_the_console_shows_the_title_engine_console", async (t) => {
    // Scenario: the console is open.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("c");
    // the title shows in the top border of the box.
    assert.ok(hasTitleBorder(screen.frame(), "Engine Console"));
});

// Each box of the root component names what it shows, centered in its top border.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DOWN_ARROW, startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

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
    assert.ok(!frame.includes("showing"));
    assert.ok(!hasTitleBorder(frame, "Engine Console"));
});

test("test_the_view_file_box_title_shows_the_file_name_and_the_range_of_file_lines", async (t) => {
    // Scenario: the View File box is open on a.txt, a file of 60 lines.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    // the title in the top border names the file and the lines on screen, from line 1.
    assert.match(screen.frame(), /╭[─ ]* a\.txt \| showing 1-\d+ of 60 lines [─ ]*╮/);
    // one press of the down arrow moves the first line on screen to line 2.
    await screen.press(DOWN_ARROW);
    assert.match(screen.frame(), /╭[─ ]* a\.txt \| showing 2-\d+ of 60 lines [─ ]*╮/);
});

test("test_the_console_shows_the_title_engine_console", async (t) => {
    // Scenario: the console is open.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("c");
    // the title shows in the top border of the box.
    assert.ok(hasTitleBorder(screen.frame(), "Engine Console"));
});

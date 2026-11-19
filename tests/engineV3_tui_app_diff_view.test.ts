// The f key of the View File box: the side-by-side diff of the marker text and the newer text, in the root component.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DOWN_ARROW, RIGHT_ARROW, startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

// The two diff titles sit side by side; the Marker Box of the main screen also has a title "Marker", so the pattern joins both boxes.
const DIFF_TITLES_PATTERN = /╭─+ newer ─+╮╭─+ Marker ─+╮/;

test("test_the_f_key_at_now_says_there_is_no_newer_state_to_compare", async (t) => {
    // Scenario: the View File box is open at Now.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    // after f the box stays open and says there is no newer state.
    await screen.press("f");
    assert.ok(screen.frame().includes("no newer state to compare"));
    assert.ok(screen.frame().includes("Up: scroll up"));
});

test("test_the_f_key_one_event_back_shows_the_newer_text_left_and_the_marker_text_right", async (t) => {
    // Scenario: the box is open one event back: the marker text is "two", the newer text is "three" (Now).
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    await screen.press(RIGHT_ARROW);
    // after f the two sides are titled newer and Marker.
    await screen.press("f");
    assert.match(screen.frame(), DIFF_TITLES_PATTERN);
    // the first diff row holds "three" and then "two".
    const changedRow = screen.frame().split("\n").find((row) => row.includes("three"))!;
    assert.ok(changedRow.indexOf("three") < changedRow.indexOf("two"));
});

test("test_the_f_key_twice_returns_to_the_numbered_text", async (t) => {
    // Scenario: the diff is shown one event back.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    await screen.press(RIGHT_ARROW);
    await screen.press("f");
    assert.match(screen.frame(), DIFF_TITLES_PATTERN);
    // the second f shows the plain numbered marker text again.
    await screen.press("f");
    assert.match(screen.frame(), / 1 two/);
    assert.doesNotMatch(screen.frame(), DIFF_TITLES_PATTERN);
});

test("test_the_view_hotkeys_list_the_f_key_as_diff", async (t) => {
    // Scenario: the View File box is open.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    // the View file hotkeys row names f.
    assert.ok(screen.frame().includes("f: diff"));
});

test("test_closing_the_box_leaves_the_diff_so_the_next_v_shows_the_plain_text", async (t) => {
    // Scenario: the diff is shown one event back, then the box is closed with c.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    await screen.press(RIGHT_ARROW);
    await screen.press("f");
    await screen.press("c");
    // the next v shows the plain numbered text.
    await screen.press("v");
    assert.match(screen.frame(), / 1 two/);
    assert.doesNotMatch(screen.frame(), DIFF_TITLES_PATTERN);
});

test("test_the_down_arrow_scrolls_the_diff_rows", async (t) => {
    // Scenario: the diff is shown one event back; the first row is the changed row "three" | "two".
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    await screen.press(RIGHT_ARROW);
    await screen.press("f");
    assert.ok(screen.frame().includes("three"));
    // three Down presses scroll the changed row away.
    await screen.press(DOWN_ARROW + DOWN_ARROW + DOWN_ARROW);
    assert.ok(!screen.frame().includes("three"));
});

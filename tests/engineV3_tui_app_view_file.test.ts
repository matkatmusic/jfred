// The View File box in the root component, drawn from a real inverse repo.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW, startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

test("test_the_v_key_opens_the_box_with_the_current_file_text_at_now", async (t) => {
    // Scenario: a walked file at Now.
    const screen = await startScreen(t, writeLongProject(t, true));
    // before v the box is closed.
    assert.ok(!screen.frame().includes("Up: scroll up"));
    // after v the box shows the numbered current text and the view hotkeys.
    await screen.press("v");
    assert.match(screen.frame(), / 1 three/);
    assert.ok(screen.frame().includes("Up: scroll up"));
});

test("test_the_info_box_is_hidden_while_the_view_file_box_is_open", async (t) => {
    // Scenario: a walked file at Now; the Info Box shows its counts row.
    const screen = await startScreen(t, writeLongProject(t, true));
    assert.ok(screen.frame().includes("modifying events in the log"));
    // the View File box is open: the Info Box is hidden.
    await screen.press("v");
    assert.ok(screen.frame().includes("Up: scroll up"));
    assert.ok(!screen.frame().includes("modifying events in the log"));
});

test("test_the_v_key_does_nothing_when_the_file_has_no_repo", async (t) => {
    // Scenario: a file whose store holds no repo.
    const screen = await startScreen(t, writeLongProject(t, false));
    // after v no box opens.
    await screen.press("v");
    assert.ok(!screen.frame().includes("Up: scroll up"));
});

test("test_the_down_arrow_scrolls_the_box_and_the_c_key_closes_it", async (t) => {
    // Scenario: the box is open on 60 lines.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    assert.match(screen.frame(), / 1 three/);
    // three presses of the down arrow scroll three lines: line 1 is gone, line 4 is the first.
    await screen.press(DOWN_ARROW + DOWN_ARROW + DOWN_ARROW);
    assert.ok(!/ 1 three/.test(screen.frame()));
    assert.match(screen.frame(), / 4 l4/);
    // the c key closes the box.
    await screen.press("c");
    assert.ok(!screen.frame().includes("Up: scroll up"));
});

test("test_right_shows_an_older_text_and_left_returns_to_the_current_text", async (t) => {
    // Scenario: the box is open at Now.
    const screen = await startScreen(t, writeLongProject(t, true));
    await screen.press("v");
    // the right arrow moves the file one event older: the text before the newest edit is "two".
    await screen.press(RIGHT_ARROW);
    assert.match(screen.frame(), / 1 two/);
    // the left arrow moves back to Now: the text is "three" again.
    await screen.press(LEFT_ARROW);
    assert.match(screen.frame(), / 1 three/);
});

// A box with its title centered in the top border.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { TitledBox, buildTopBorderText } from "../engineV3/tui/engineV3_tui_titled_box.tsx";

test("test_the_top_border_text_centers_the_title_between_dashes", () => {
    // Scenario: the title "Legend" in a box of 20 columns. The title field " Legend " takes 8 of the 18 inner columns.
    // 10 dashes remain: 5 on each side.
    assert.equal(buildTopBorderText("Legend", 20), "╭───── Legend ─────╮");
});

test("test_the_top_border_text_puts_the_extra_dash_on_the_right_when_the_dashes_are_odd", () => {
    // Scenario: the title "Legend" in a box of 21 columns: 11 dashes remain, 5 left and 6 right.
    assert.equal(buildTopBorderText("Legend", 21), "╭───── Legend ──────╮");
});

test("test_a_title_that_does_not_fit_is_cut_and_ends_with_an_ellipsis", () => {
    // Scenario: a 30 letter title in a box of 20 columns: 18 inner columns hold a field of 2 spaces and 16 letters.
    const title = "a.ts | showing 1-4 of 12 lines";
    // the title keeps its first 15 letters and the ellipsis; the border keeps its width.
    const borderText = buildTopBorderText(title, 20);
    assert.equal(borderText, "╭ a.ts | showing … ╮");
    assert.equal(borderText.length, 20);
});

test("test_a_titled_box_draws_the_title_border_then_the_content_then_the_bottom_border_at_the_full_width", async (t) => {
    // Scenario: a titled box of 20 columns holds the text "hello".
    const screen = render(createElement(TitledBox, { title: "Legend", columns: 20 }, createElement(Text, null, "hello")));
    t.after(() => screen.unmount());
    const lines = screen.lastFrame()!.split("\n");
    // the first line is the title border, the middle line holds the text between the side borders, the last line is the bottom border.
    assert.equal(lines[0], "╭───── Legend ─────╮");
    assert.equal(lines[1], "│hello             │");
    assert.equal(lines[2], "╰──────────────────╯");
    assert.equal(lines.length, 3);
});

test("test_a_titled_box_with_a_fixed_height_keeps_that_height_including_the_title_border", async (t) => {
    // Scenario: a titled box of 20 columns and 6 rows.
    const screen = render(createElement(TitledBox, { title: "Engine Console", columns: 20, height: 6 }, createElement(Text, null, "hello")));
    t.after(() => screen.unmount());
    // the frame has 6 lines.
    assert.equal(screen.lastFrame()!.split("\n").length, 6);
});

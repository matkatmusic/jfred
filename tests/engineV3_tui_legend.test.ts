import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { buildBarLegendLines } from "../engineV3/tui/engineV3_tui_legend.ts";
import { LegendBox } from "../engineV3/tui/engineV3_tui_footer.tsx";

test("test_the_legend_is_split_into_3_rows", () => {
    // Scenario: build the legend lines.
    const lines = buildBarLegendLines();
    // There are 3 lines.
    assert.equal(lines.length, 3);
});

test("test_the_legend_box_with_3_lines_is_5_rows_tall", () => {
    // Scenario: render the legend box on a 120 column screen.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 120 })).lastFrame()!;
    // The frame has 5 rows: 3 text rows and the top and bottom border.
    assert.equal(frame.split("\n").length, 5);
});

test("test_the_legend_has_one_entry_for_each_bar_symbol", () => {
    // Scenario: build the legend entries.
    const entries = buildBarLegendLines().flat();
    // Every symbol that a bar can show has an entry.
    const labels = entries.map((entry) => entry.label);
    for (const symbol of ["─", "█", "│", "+", "-", "←", "●"]) {
        assert.ok(labels.includes(symbol), `missing the symbol ${symbol}`);
    }
});

// test("test_the_dot_entry_names_each_dot_color_with_its_meaning", () => {
//     // Scenario: build the legend entries.
//     const dotEntry = buildBarLegendLines().flat().find((entry) => entry.label === "●")!;
//     // The value pairs each color with the dot kind from the web page.
//     assert.ok(dotEntry.value.includes("blue commit"));
//     assert.ok(dotEntry.value.includes("green snapshot"));
//     assert.ok(dotEntry.value.includes("gray read"));
//     assert.ok(dotEntry.value.includes("magenta script run"));
// });

test("test_the_legend_box_shows_the_symbols_and_their_meaning", () => {
    // Scenario: render the legend box on a 120 column screen.
    const frame = render(createElement(LegendBox, { lines: buildBarLegendLines(), columns: 120 })).lastFrame()!;
    // The frame shows a symbol and its meaning text.
    assert.ok(frame.includes("█"));
    assert.ok(frame.includes("time marker"));
});

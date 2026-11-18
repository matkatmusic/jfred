process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { EngineLogLineKind } from "../engineV3/tui/engineV3_tui_engine_log.ts";
import type { EngineLogLine } from "../engineV3/tui/engineV3_tui_engine_log.ts";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink-testing-library");
const { ConsoleBox, clampConsoleScrollTop } = await import("../engineV3/tui/engineV3_tui_console_box.tsx");

const GREEN_START = "\x1b[32m";
const CYAN_START = "\x1b[36m";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function makeLines(): EngineLogLine[] {
    return [
        { kind: EngineLogLineKind.Raw, text: "raw zero" },
        { kind: EngineLogLineKind.Summary, text: "summary one" },
        { kind: EngineLogLineKind.Raw, text: "raw two" },
        { kind: EngineLogLineKind.Raw, text: "raw three" },
    ];
}

function drawBox(lines: EngineLogLine[], scrollTop: number, rowCount: number, columns: number): string {
    const { lastFrame } = render(createElement(ConsoleBox, { lines, scrollTop, rowCount, columns, summaryColor: "green", rawColor: "cyan" }));
    return lastFrame()!;
}

test("test_the_box_shows_the_lines_from_scrollTop_inside_the_rows_left_by_the_border", () => {
    // Scenario: 4 lines, scrollTop 1, a box of 4 rows has 2 inner rows.
    const text = drawBox(makeLines(), 1, 4, 40).replace(ANSI_PATTERN, "");
    // the second and third lines show; the first and fourth do not.
    assert.ok(text.includes("summary one"));
    assert.ok(text.includes("raw two"));
    assert.ok(!text.includes("raw zero"));
    assert.ok(!text.includes("raw three"));
});

test("test_the_box_is_exactly_rowCount_rows_tall_with_a_round_border", () => {
    // Scenario: a box of 6 rows holding only 2 lines.
    const frame = drawBox(makeLines().slice(0, 2), 0, 6, 40).replace(ANSI_PATTERN, "");
    // the frame has 6 rows, starts with the round corner, and ends with the round corner.
    const rows = frame.split("\n");
    assert.equal(rows.length, 6);
    assert.ok(rows[0]!.startsWith("╭"));
    assert.ok(rows[5]!.endsWith("╯"));
});

test("test_the_box_colors_summary_lines_and_raw_lines_differently", () => {
    // Scenario: one summary line then one raw line, summary green, raw cyan.
    const rows = drawBox([makeLines()[1]!, makeLines()[0]!], 0, 4, 40).split("\n");
    // the summary row has the green start code; the raw row has the cyan start code.
    assert.ok(rows[1]!.includes(`${GREEN_START}summary one`));
    assert.ok(rows[2]!.includes(`${CYAN_START}raw zero`));
});

test("test_a_line_longer_than_the_box_is_cut_to_one_row", () => {
    // Scenario: a 60 letter line in a box 20 columns wide.
    const lines = [{ kind: EngineLogLineKind.Raw, text: "x".repeat(60) }];
    const rows = drawBox(lines, 0, 4, 20).replace(ANSI_PATTERN, "").split("\n");
    // the box keeps 4 rows and every row is 20 columns wide.
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.length === 20));
});

test("test_clampConsoleScrollTop_stays_between_zero_and_the_last_full_page", () => {
    // Scenario: 10 lines, 4 visible: the largest scrollTop is 6.
    assert.equal(clampConsoleScrollTop(-5, 10, 4), 0);
    assert.equal(clampConsoleScrollTop(3, 10, 4), 3);
    assert.equal(clampConsoleScrollTop(99, 10, 4), 6);
});

test("test_clampConsoleScrollTop_gives_zero_when_all_lines_fit", () => {
    // Scenario: 2 lines, 4 visible: nothing to scroll.
    assert.equal(clampConsoleScrollTop(5, 2, 4), 0);
});

process.env.FORCE_COLOR = "1";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createElement } from "react";

// Dynamic imports: chalk reads FORCE_COLOR when it loads, so Ink must load after the line above.
const { render } = await import("ink");
const { MarkerBox, MARKER_BOX_ROW_COUNT } = await import("../engineV3/tui/engineV3_tui_marker_box.tsx");
const { computeInnerColumnCount, computeMarkerBoxLayout, formatEventTimeText } = await import("../engineV3/tui/engineV3_tui_marker_box_layout.ts");

const BOX_COLUMNS = 135;
const EVENT_COUNT = 7;
const MARKED_COLOR_START = "\x1b[33m";
const ARROW_COLOR_START = "\x1b[37m";
const TIME_COLOR_START = "\x1b[32m";

function makeEventInstants(eventCount: number): Date[] {
    const eventInstants: Date[] = [];
    for (let position = 1; position <= eventCount; ++position) {
        eventInstants.push(new Date(2026, 0, 10 - position, 12, 0, 0));
    }
    return eventInstants;
}

// the time text of position p
function nowMinus(position: number): string {
    return formatEventTimeText(makeEventInstants(EVENT_COUNT)[position - 1]!);
}

// ink-testing-library fixes the terminal width at 100 columns, which squeezes a 135 column box, so this test uses its own output stream.
class WideStdout extends EventEmitter {
    columns = 200;
    lastFrame = "";
    write = (frame: string) => {
        if (frame.trim() !== "") {
            this.lastFrame = frame;
        }
    };
}

function renderFrame(eventCount: number, markedPosition: number, windowStart: number, columns: number = BOX_COLUMNS): string {
    const stdout = new WideStdout();
    const instance = render(createElement(MarkerBox, { eventInstants: makeEventInstants(eventCount), markedPosition, windowStart, columns, markedColor: "yellow", arrowColor: "white", timeColor: "green" }), { stdout: stdout as never, debug: true, exitOnCtrlC: false, patchConsole: false });
    instance.unmount();
    return stdout.lastFrame;
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// the middle line of the frame without the border, the padding and the repeated spaces
function getRowText(frame: string): string {
    const middleLine = stripAnsi(frame).split("\n")[1]!;
    return middleLine.replace(/^│/, "").replace(/│$/, "").replace(/\s+/g, " ").trim();
}

function getExpectedRowText(newerText: string, positionTexts: string[], olderText: string): string {
    return `${newerText} ${positionTexts.join(" | ")} ${olderText}`;
}

test("test_stepping_right_draws_the_row_text_of_the_approved_table", () => {
    // Scenario: 7 events, 3 inner columns, the marker steps right from 0 to 7; the row text of each step is the approved table row.
    const t = nowMinus;
    const expectedRowTexts = [
        getExpectedRowText("(0 newer events)", ["[now]", t(1), t(2), t(3), "Earlier ->"], "(4 older events)"),
        getExpectedRowText("(0 newer events)", ["now", `[${t(1)}]`, t(2), t(3), "Earlier ->"], "(4 older events)"),
        getExpectedRowText("(0 newer events)", ["now", t(1), `[${t(2)}]`, t(3), "Earlier ->"], "(4 older events)"),
        getExpectedRowText("(0 newer events)", ["now", t(1), t(2), `[${t(3)}]`, "Earlier ->"], "(4 older events)"),
        getExpectedRowText("(1 newer event)", ["<- Now", t(2), t(3), `[${t(4)}]`, "Earlier ->"], "(3 older events)"),
        getExpectedRowText("(2 newer events)", ["<- Now", t(3), t(4), `[${t(5)}]`, "Earlier ->"], "(2 older events)"),
        getExpectedRowText("(3 newer events)", ["<- Now", t(4), t(5), `[${t(6)}]`, "Earliest"], "(0 older events)"),
        getExpectedRowText("(3 newer events)", ["<- Now", t(4), t(5), t(6), "[Earliest]"], "(0 older events)"),
    ];
    const innerColumnCount = computeInnerColumnCount(BOX_COLUMNS);
    let previousWindowStart: number | undefined = undefined;
    for (const [markedPosition, expectedRowText] of expectedRowTexts.entries()) {
        const { windowStart } = computeMarkerBoxLayout(EVENT_COUNT, markedPosition, previousWindowStart, innerColumnCount);
        // the drawn row equals the table row.
        assert.equal(getRowText(renderFrame(EVENT_COUNT, markedPosition, windowStart)), expectedRowText, `step ${markedPosition}`);
        previousWindowStart = windowStart;
    }
});

test("test_stepping_left_draws_the_row_text_of_the_mirror_table", () => {
    // Scenario: the marker steps left from 7 to 0, starting with the window at 4; the row text of each step is the mirror table row.
    const t = nowMinus;
    const expectedRowTexts = [
        getExpectedRowText("(3 newer events)", ["<- Now", t(4), t(5), t(6), "[Earliest]"], "(0 older events)"),
        getExpectedRowText("(3 newer events)", ["<- Now", t(4), t(5), `[${t(6)}]`, "Earliest"], "(0 older events)"),
        getExpectedRowText("(3 newer events)", ["<- Now", t(4), `[${t(5)}]`, t(6), "Earliest"], "(0 older events)"),
        getExpectedRowText("(3 newer events)", ["<- Now", `[${t(4)}]`, t(5), t(6), "Earliest"], "(0 older events)"),
        getExpectedRowText("(2 newer events)", ["<- Now", `[${t(3)}]`, t(4), t(5), "Earlier ->"], "(2 older events)"),
        getExpectedRowText("(1 newer event)", ["<- Now", `[${t(2)}]`, t(3), t(4), "Earlier ->"], "(3 older events)"),
        getExpectedRowText("(0 newer events)", ["now", `[${t(1)}]`, t(2), t(3), "Earlier ->"], "(4 older events)"),
        getExpectedRowText("(0 newer events)", ["[now]", t(1), t(2), t(3), "Earlier ->"], "(4 older events)"),
    ];
    const innerColumnCount = computeInnerColumnCount(BOX_COLUMNS);
    let previousWindowStart: number | undefined = 4;
    for (const [stepIndex, expectedRowText] of expectedRowTexts.entries()) {
        const markedPosition = EVENT_COUNT - stepIndex;
        const { windowStart } = computeMarkerBoxLayout(EVENT_COUNT, markedPosition, previousWindowStart, innerColumnCount);
        assert.equal(getRowText(renderFrame(EVENT_COUNT, markedPosition, windowStart)), expectedRowText, `marked ${markedPosition}`);
        previousWindowStart = windowStart;
    }
});

test("test_the_box_is_three_rows_tall_with_round_corners_and_the_full_width", () => {
    // Scenario: the box has a top border, one row and a bottom border.
    const frame = renderFrame(EVENT_COUNT, 0, 1);
    const lines = stripAnsi(frame).split("\n");
    assert.equal(lines.length, MARKER_BOX_ROW_COUNT);
    assert.equal(MARKER_BOX_ROW_COUNT, 3);
    assert.ok(lines[0]!.startsWith("╭"), frame);
    assert.ok(lines[2]!.startsWith("╰"), frame);
    // every line is exactly `columns` wide.
    for (const line of lines) {
        assert.equal(line.length, BOX_COLUMNS, line);
    }
});

test("test_the_inner_columns_do_not_move_when_the_counts_change", () => {
    // Scenario: the column of the first "|" is the same at step 0 (0 newer) and at step 7 (3 newer).
    const firstSeparatorColumn = (frame: string) => stripAnsi(frame).split("\n")[1]!.indexOf("|");
    assert.equal(firstSeparatorColumn(renderFrame(EVENT_COUNT, 0, 1)), firstSeparatorColumn(renderFrame(EVENT_COUNT, 7, 4)));
});

test("test_the_marked_item_is_yellow_the_arrows_white_and_the_other_times_green", () => {
    // Scenario: step 4 shows "<- Now", the marked [t4], the times t2 and t3, and "Earlier ->".
    const frame = renderFrame(EVENT_COUNT, 4, 2);
    // the marked item with its brackets has the yellow code before it.
    assert.ok(frame.includes(`${MARKED_COLOR_START}[${nowMinus(4)}]`), JSON.stringify(frame));
    // "<- Now" and "Earlier ->" have the white code before them, joined with their count text, which is white too.
    assert.ok(frame.includes(`${ARROW_COLOR_START}(1 newer event) <- Now`), JSON.stringify(frame));
    assert.ok(frame.includes(`${ARROW_COLOR_START}Earlier -> (3 older events)`), JSON.stringify(frame));
    // an unmarked time has the green code before it.
    assert.ok(frame.includes(`${TIME_COLOR_START} ${nowMinus(2)} `), JSON.stringify(frame));
});

test("test_the_marked_now_and_the_marked_earliest_are_yellow", () => {
    // Scenario: the marker is on now, then on Earliest.
    assert.ok(renderFrame(EVENT_COUNT, 0, 1).includes(`${MARKED_COLOR_START}[now]`));
    assert.ok(renderFrame(EVENT_COUNT, 7, 4).includes(`${MARKED_COLOR_START}[Earliest]`));
});

test("test_with_no_events_the_row_is_only_the_newer_count_and_the_marked_now", () => {
    // Scenario: K = 0.
    assert.equal(getRowText(renderFrame(0, 0, 1)), "(0 newer events) [now]");
});

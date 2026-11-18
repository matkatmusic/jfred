// The window start of the marker box: kept while the cursor file stays, forgotten when the cursor file changes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { Path } from "../src/structures/domain.ts";
import { useMarkerWindowStart } from "../engineV3/tui/engineV3_tui_marker_window.ts";

const WIDE_COLUMNS = 200;
const EVENT_COUNT = 20;

function Probe({ file, markedPosition }: { file: Path; markedPosition: number }) {
    return createElement(Text, null, `start ${useMarkerWindowStart(file, EVENT_COUNT, markedPosition, WIDE_COLUMNS)}`);
}

const FILE_A = new Path("/project/a.txt");
const FILE_B = new Path("/project/b.txt");

test("test_the_window_start_follows_the_marked_position_out_of_the_window", () => {
    // Scenario: 20 events, 5 inner columns; file A is marked at position 10.
    const { lastFrame } = render(createElement(Probe, { file: FILE_A, markedPosition: 10 }));
    // the window ends at the marked position: it starts at 6.
    assert.equal(lastFrame(), "start 6");
});

test("test_the_window_start_stays_while_the_marked_position_stays_in_the_window", () => {
    // Scenario: file A is marked at 10 (window starts at 6), then at 8.
    const { lastFrame, rerender } = render(createElement(Probe, { file: FILE_A, markedPosition: 10 }));
    rerender(createElement(Probe, { file: FILE_A, markedPosition: 8 }));
    // position 8 lies inside the window 6 to 10: the window start stays 6.
    assert.equal(lastFrame(), "start 6");
});

test("test_the_window_start_is_forgotten_when_the_cursor_file_changes", () => {
    // Scenario: file A is marked at 10 (window starts at 6); then file B is marked at 8.
    const { lastFrame, rerender } = render(createElement(Probe, { file: FILE_A, markedPosition: 10 }));
    rerender(createElement(Probe, { file: FILE_B, markedPosition: 8 }));
    // the window is computed with no previous start: it starts at 4.
    assert.equal(lastFrame(), "start 4");
});

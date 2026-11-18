// The top-to-bottom order of the boxes in the root component.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

function findLineIndex(frame: string, text: string): number {
    const lineIndex = frame.split("\n").findIndex((line) => line.includes(text));
    assert.notEqual(lineIndex, -1, `no line holds ${text}`);
    return lineIndex;
}

test("test_the_marker_box_is_above_the_status_row_and_the_status_row_is_above_the_file_rows", async (t) => {
    // Scenario: two repos are stale, so the status row shows text.
    const screen = await startScreen(t, writeLongProject(t, true), { staleRepoCount: 2 });
    const frame = screen.frame();
    const legendLine = findLineIndex(frame, "undone so far");
    const markerLine = findLineIndex(frame, "newer events");
    const statusLine = findLineIndex(frame, "2 repos are stale");
    const fileRowLine = findLineIndex(frame, "a.txt");
    // the order is: legend, marker box, status row, file rows.
    assert.ok(legendLine < markerLine);
    assert.ok(markerLine < statusLine);
    assert.ok(statusLine < fileRowLine);
});

test("test_the_info_box_is_below_the_file_rows_and_the_hotkeys_box_is_below_the_info_box", async (t) => {
    // Scenario: nothing is open.
    const screen = await startScreen(t, writeLongProject(t, true));
    const frame = screen.frame();
    const fileRowLine = findLineIndex(frame, "a.txt");
    const infoLine = findLineIndex(frame, "modifying events in the log");
    const hotKeysLine = findLineIndex(frame, "Actions:");
    // the order is: file rows, info box, hotkeys box.
    assert.ok(fileRowLine < infoLine);
    assert.ok(infoLine < hotKeysLine);
});

// The root component walks a file only after a Left or Right key, never by itself.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AppProps } from "../engineV3/tui/engineV3_tui_app_types.ts";
import { DOWN_ARROW, RIGHT_ARROW, startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

function makeWalkerSpy(walkedFilePaths: string[]): AppProps["walker"] {
    return {
        walkHistoryTo: (_currentTime, file) => {
            walkedFilePaths.push(file.toString());
            return false;
        },
        handleOutcome: async () => {},
        playScript: async () => {},
    };
}

test("test_mounting_the_app_walks_no_file_when_no_file_covers_the_marker_time", async (t) => {
    // Scenario: no file covers any time, so the old code walked every visible file at mount.
    const walkedFilePaths: string[] = [];
    await startScreen(t, writeLongProject(t, false), { isTimeSpannedForFile: () => false, walker: makeWalkerSpy(walkedFilePaths) });
    // no walk was requested.
    assert.deepEqual(walkedFilePaths, []);
});

test("test_the_down_key_walks_no_file", async (t) => {
    // Scenario: no file covers any time; the cursor moves down.
    const walkedFilePaths: string[] = [];
    const screen = await startScreen(t, writeLongProject(t, false), { isTimeSpannedForFile: () => false, walker: makeWalkerSpy(walkedFilePaths) });
    await screen.press(DOWN_ARROW);
    // no walk was requested.
    assert.deepEqual(walkedFilePaths, []);
});

test("test_the_right_key_walks_a_file_that_does_not_cover_the_new_time", async (t) => {
    // Scenario: no file covers any time; the marker steps right.
    const walkedFilePaths: string[] = [];
    const project = writeLongProject(t, false);
    const screen = await startScreen(t, project, { isTimeSpannedForFile: () => false, walker: makeWalkerSpy(walkedFilePaths) });
    await screen.press(RIGHT_ARROW);
    // the walker got a request for the file.
    assert.ok(walkedFilePaths.includes(project.file.toString()));
});

// Tests for the shared find box harness in ./layer1-find-file-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    COLLIDING_PATHS,
    dispatchCycleButtonClick,
    jumpToBubbleAtPath,
    openFoundPage,
    readCrumbText,
    readFindStatusText,
    scrolledOptions,
    scrolledPaths,
    sendTermWithEnter,
} from "./layer1-find-file-helpers.ts";

test("test_open_found_page_builds_one_bubble_per_path_with_the_full_path_in_data_path", () => {
    openFoundPage(["src/a.ts", "tasks.json"]);
    const fnames = [...document.querySelectorAll(".filebox .fname")];
    assert.deepEqual(fnames.map((fname) => fname.textContent), ["a.ts", "tasks.json"]);
    assert.deepEqual(fnames.map((fname) => fname.getAttribute("data-path")), ["src/a.ts", "tasks.json"]);
});

test("test_open_found_page_empties_the_scroll_records_left_by_an_earlier_page", () => {
    openFoundPage(COLLIDING_PATHS);
    jumpToBubbleAtPath("tasks.json");
    assert.equal(scrolledPaths.length, 1);
    assert.equal(scrolledOptions.length, 1);
    openFoundPage(COLLIDING_PATHS);
    assert.equal(scrolledPaths.length, 0);
    assert.equal(scrolledOptions.length, 0);
});

test("test_send_term_with_enter_scrolls_to_the_first_match_and_reports_in_the_find_status", () => {
    openFoundPage(COLLIDING_PATHS);
    sendTermWithEnter("launch.json");
    assert.deepEqual(scrolledPaths, [".claude/launch.json"]);
    assert.match(readFindStatusText(), /1 of 3/);
});

test("test_dispatch_cycle_button_click_steps_to_the_next_match", () => {
    openFoundPage(COLLIDING_PATHS);
    sendTermWithEnter("launch.json");
    dispatchCycleButtonClick("find-next");
    assert.deepEqual(scrolledPaths, [".claude/launch.json", ".vscode/launch.json"]);
});

test("test_read_crumb_text_returns_the_crumb_text_and_is_empty_on_a_fresh_page", () => {
    openFoundPage(COLLIDING_PATHS);
    assert.equal(typeof readCrumbText(), "string");
    assert.doesNotMatch(readCrumbText(), /of \d/);
});

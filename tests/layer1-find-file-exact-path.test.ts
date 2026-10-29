// Layer 1's exact-path jump tests (File Nav leaf clicks); DOM boot and readouts live in ./layer1-find-file-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    COLLIDING_PATHS,
    moveToBubbleAtPath,
    openFoundPage,
    readCrumbText,
    readFindStatusText,
    scrolledPaths,
} from "./layer1-find-file-helpers.ts";

test("test_an_exact_path_jump_lands_the_same_bubble_however_many_times_it_is_repeated", () => {
    // A File Nav leaf knows its exact path, so repeat clicks land the same bubble.
    openFoundPage(COLLIDING_PATHS);
    moveToBubbleAtPath("tasks.json");
    moveToBubbleAtPath("tasks.json");
    assert.deepEqual(scrolledPaths, ["tasks.json", "tasks.json"]);
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("data-path"), "tasks.json");
});

test("test_an_exact_path_jump_does_not_write_the_find_boxs_counter_into_the_crumb", () => {
    // A click is not a search, so it must not report as one in the header crumb.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    moveToBubbleAtPath(".vscode/settings.json");
    // the crumb carries no find-counter text.
    assert.doesNotMatch(readCrumbText(), /of \d/);
});

test("test_an_exact_path_with_no_bubble_reports_instead_of_doing_nothing", () => {
    // An orphan path lives in a bucket with no bubble, so clicking it must say so, not appear broken.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    moveToBubbleAtPath("src/deleted-long-ago.ts");
    assert.deepEqual(scrolledPaths, []);
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    // but the readout names the path and why it has no bubble.
    assert.match(readFindStatusText(), /src\/deleted-long-ago\.ts/);
});

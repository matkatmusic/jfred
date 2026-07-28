// Layer 1's jump-to-bubble box tests; DOM boot, scrollIntoView spy, fixture, and readouts live in ./layer1-find-file-helpers.ts to keep this file short.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    clickCycleButton,
    COLLIDING_PATHS,
    jumpToBubbleAtPath,
    jumpToNamedBubble,
    openFoundPage,
    readCrumbText,
    readFindStatusText,
    scrolledOptions,
    scrolledPaths,
    submitTermWithEnter,
} from "./layer1-find-file-helpers.ts";

test("test_a_bare_basename_scrolls_to_its_bubble", () => {
    // The bubble's visible label is the basename, so the box must accept what the user sees, not the full path.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToNamedBubble("settings.json");
    assert.deepEqual(scrolledPaths, [".vscode/settings.json"]);
    assert.equal(document.querySelectorAll(".filebox.found").length, 1);
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("data-path"), ".vscode/settings.json");
    // and the readout names it rather than leaving the jump unreported (requirement 5).
    assert.match(readFindStatusText(), /1 of 1 · \.vscode\/settings\.json/);
});

test("test_a_colliding_basename_cycles_through_every_match_and_wraps", () => {
    // A colliding basename is not an error: repeat submits walk the matches in order, and the fourth wraps to first.
    openFoundPage(COLLIDING_PATHS);
    for (let submit = 0; submit < 4; submit++) {
        jumpToNamedBubble("launch.json");
    }
    assert.deepEqual(scrolledPaths, [
        ".claude/launch.json",
        ".vscode/launch.json",
        ".vscode-parent/launch.json",
        ".claude/launch.json",
    ]);
    // the counter says how far through the cycle the viewport is, so an ambiguous term is navigable rather than confusing.
    assert.match(readFindStatusText(), /1 of 3 · \.claude\/launch\.json/);
    assert.equal(document.querySelectorAll(".filebox.found").length, 1);
});

test("test_a_partial_path_narrows_a_colliding_basename_to_one_bubble", () => {
    // One substring rule serves both this and the bare-basename case above, which is why module has no separate path branch.
    openFoundPage(COLLIDING_PATHS);
    jumpToNamedBubble(".vscode/tasks");
    assert.deepEqual(scrolledPaths, [".vscode/tasks.json"]);
    assert.match(readFindStatusText(), /1 of 1 · \.vscode\/tasks\.json/);
});

test("test_an_unmatched_name_reports_instead_of_doing_nothing", () => {
    // A typo must never look like a broken page: the readout quotes the term back.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToNamedBubble("no-such-file.txt");
    assert.deepEqual(scrolledPaths, []);
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    assert.equal(readFindStatusText(), 'find "no-such-file.txt": no bubble matches');
});

test("test_a_jump_aligns_the_bubbles_top_edge_rather_than_its_middle", () => {
    // A `.filebox` is as tall as its ladder span, so centring it vertically puts its top far above the viewport.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToNamedBubble("settings.json");
    assert.equal(scrolledOptions[0]!.block, "start");
    assert.equal(scrolledOptions[0]!.inline, "center");
});

test("test_an_exact_path_jump_lands_the_same_bubble_however_many_times_it_is_repeated", () => {
    // A File Nav leaf knows its exact path, so clicking it twice lands the same bubble, not a search cycle.
    openFoundPage(COLLIDING_PATHS);
    jumpToBubbleAtPath("tasks.json");
    jumpToBubbleAtPath("tasks.json");
    assert.deepEqual(scrolledPaths, ["tasks.json", "tasks.json"]);
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("data-path"), "tasks.json");
});

test("test_an_exact_path_jump_does_not_write_the_find_boxs_counter_into_the_crumb", () => {
    // A click is not a search, so it must not report as one in the header crumb.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToBubbleAtPath(".vscode/settings.json");
    // the crumb carries no find-counter text.
    assert.doesNotMatch(readCrumbText(), /of \d/);
});

test("test_an_exact_path_with_no_bubble_reports_instead_of_doing_nothing", () => {
    // An orphan path lives in a bucket with no bubble, so clicking it must say so, not appear broken.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToBubbleAtPath("src/deleted-long-ago.ts");
    assert.deepEqual(scrolledPaths, []);
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    // but the readout names the path and why it has no bubble.
    assert.match(readFindStatusText(), /src\/deleted-long-ago\.ts/);
});

test("test_the_enter_key_on_the_box_is_what_submits", () => {
    // Driving the keystroke rather than the exported function proves the wiring a direct call cannot cover.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = "reconstruction_cli.ts";
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.deepEqual(scrolledPaths, ["src/reconstruction_cli.ts"]);
    // a NON-Enter keystroke does not submit — the box would otherwise jump on every character.
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    assert.deepEqual(scrolledPaths, ["src/reconstruction_cli.ts"]);
});

test("test_clearing_the_find_box_clears_its_result_readout", () => {
    // Emptying the box drops all three pieces of the abandoned search, so the next term starts at its first match.
    openFoundPage(COLLIDING_PATHS);
    jumpToNamedBubble("launch.json");
    jumpToNamedBubble("launch.json");
    assert.match(readFindStatusText(), /2 of 3/);
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = "";
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(readFindStatusText(), "");
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    jumpToNamedBubble("launch.json");
    assert.equal(scrolledPaths.at(-1), ".claude/launch.json");
});

test("test_the_next_button_steps_forward_through_the_matches", () => {
    // Repeat-Enter was the only way to reach match 2 of 3, so the button continues the same cycle, not restarts.
    openFoundPage(COLLIDING_PATHS);
    submitTermWithEnter("launch.json");
    clickCycleButton("find-next");
    clickCycleButton("find-next");
    assert.deepEqual(scrolledPaths, [
        ".claude/launch.json",
        ".vscode/launch.json",
        ".vscode-parent/launch.json",
    ]);
    assert.match(readFindStatusText(), /3 of 3/);
});

test("test_the_previous_button_steps_backward_and_wraps", () => {
    // Without backward stepping, overshooting a match means cycling all the way round; stepping back from first must wrap to last.
    openFoundPage(COLLIDING_PATHS);
    submitTermWithEnter("launch.json");
    clickCycleButton("find-prev");
    assert.equal(scrolledPaths.at(-1), ".vscode-parent/launch.json");
    assert.match(readFindStatusText(), /3 of 3/);
});

test("test_the_find_widget_sits_at_the_end_of_the_jump_bar", () => {
    // Navigation controls sat in unrelated places; the user asked for the find widget right of the last `Jump to:` button.
    openFoundPage([]);
    const jumpbar = document.querySelector(".jumpbar")!;
    for (const id of ["find-file", "find-prev", "find-next", "find-status"]) {
        assert.ok(jumpbar.contains(document.getElementById(id)), `${id} is not in the jump bar`);
    }
    const children = [...jumpbar.children];
    const lastBucketButton = [...jumpbar.querySelectorAll("[data-bucket]")].at(-1)!;
    const findLabel = document.getElementById("find-file")!.closest("label")!;
    assert.ok(children.indexOf(findLabel) > children.indexOf(lastBucketButton));
});

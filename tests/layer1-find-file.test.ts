// Layer 1 jump-to-bubble box tests; DOM boot, spy, fixture, and readouts live in ./layer1-find-file-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    COLLIDING_PATHS,
    moveToNamedBubble,
    openFoundPage,
    readFindStatusText,
    scrolledOptions,
    scrolledPaths,
} from "./layer1-find-file-helpers.ts";

test("test_a_bare_basename_scrolls_to_its_bubble", () => {
    // The bubble label is the basename, so the box accepts what the user sees.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    moveToNamedBubble("settings.json");
    assert.deepEqual(scrolledPaths, [".vscode/settings.json"]);
    assert.equal(document.querySelectorAll(".filebox.found").length, 1);
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("data-path"), ".vscode/settings.json");
    // and the readout names it rather than leaving the jump unreported (requirement 5).
    assert.match(readFindStatusText(), /1 of 1 · \.vscode\/settings\.json/);
});

test("test_a_colliding_basename_cycles_through_every_match_and_wraps", () => {
    // A colliding basename is no error: repeat submits walk matches in order, and the fourth wraps.
    openFoundPage(COLLIDING_PATHS);
    for (let submit = 0; submit < 4; submit++) {
        moveToNamedBubble("launch.json");
    }
    assert.deepEqual(scrolledPaths, [
        ".claude/launch.json",
        ".vscode/launch.json",
        ".vscode-parent/launch.json",
        ".claude/launch.json",
    ]);
    // The counter shows progress through the cycle, so an ambiguous term stays navigable.
    assert.match(readFindStatusText(), /1 of 3 · \.claude\/launch\.json/);
    assert.equal(document.querySelectorAll(".filebox.found").length, 1);
});

test("test_a_partial_path_narrows_a_colliding_basename_to_one_bubble", () => {
    // One substring rule serves this and the bare-basename case, so the module has no path branch.
    openFoundPage(COLLIDING_PATHS);
    moveToNamedBubble(".vscode/tasks");
    assert.deepEqual(scrolledPaths, [".vscode/tasks.json"]);
    assert.match(readFindStatusText(), /1 of 1 · \.vscode\/tasks\.json/);
});

test("test_an_unmatched_name_reports_instead_of_doing_nothing", () => {
    // A typo must never look like a broken page: the readout quotes the term back.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    moveToNamedBubble("no-such-file.txt");
    assert.deepEqual(scrolledPaths, []);
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    assert.equal(readFindStatusText(), 'find "no-such-file.txt": no bubble matches');
});

test("test_a_jump_aligns_the_bubbles_top_edge_rather_than_its_middle", () => {
    // A `.filebox` is as tall as its ladder span, so centring puts its top above the viewport.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    moveToNamedBubble("settings.json");
    assert.equal(scrolledOptions[0]!.block, "start");
    assert.equal(scrolledOptions[0]!.inline, "center");
});

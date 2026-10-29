// Layer 1's find-box control tests (Enter key, clear, next/previous buttons, jump-bar placement); DOM boot and readouts live in ./layer1-find-file-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    COLLIDING_PATHS,
    dispatchCycleButtonClick,
    moveToNamedBubble,
    openFoundPage,
    readFindStatusText,
    scrolledPaths,
    sendTermWithEnter,
} from "./layer1-find-file-helpers.ts";

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
    // Emptying the box drops the abandoned search state, so the next term starts at its first match.
    openFoundPage(COLLIDING_PATHS);
    moveToNamedBubble("launch.json");
    moveToNamedBubble("launch.json");
    assert.match(readFindStatusText(), /2 of 3/);
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = "";
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    assert.equal(readFindStatusText(), "");
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    moveToNamedBubble("launch.json");
    assert.equal(scrolledPaths.at(-1), ".claude/launch.json");
});

test("test_the_next_button_steps_forward_through_the_matches", () => {
    // Repeat-Enter was the only way to reach later matches, so the button continues the same cycle.
    openFoundPage(COLLIDING_PATHS);
    sendTermWithEnter("launch.json");
    dispatchCycleButtonClick("find-next");
    dispatchCycleButtonClick("find-next");
    assert.deepEqual(scrolledPaths, [
        ".claude/launch.json",
        ".vscode/launch.json",
        ".vscode-parent/launch.json",
    ]);
    assert.match(readFindStatusText(), /3 of 3/);
});

test("test_the_previous_button_steps_backward_and_wraps", () => {
    // Stepping back from the first match must wrap to the last, avoiding a full forward cycle.
    openFoundPage(COLLIDING_PATHS);
    sendTermWithEnter("launch.json");
    dispatchCycleButtonClick("find-prev");
    assert.equal(scrolledPaths.at(-1), ".vscode-parent/launch.json");
    assert.match(readFindStatusText(), /3 of 3/);
});

test("test_the_find_widget_sits_at_the_end_of_the_jump_bar", () => {
    // The user asked for the find widget right of the last `Jump to:` button.
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

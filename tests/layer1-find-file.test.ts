// The Layer 1 page's jump-to-bubble box (task 261). The render is 808 widgets across ~156,000 px,
// so the box is what makes "look at the launch.json bubble" a workable handoff.
//
// The DOM boot, the scrollIntoView spy, the bubble fixture and the two readouts live in
// ./layer1-find-file-helpers.ts — tasks 271 and 273 pushed this file past the repo's 250-line cap,
// and setup is the half that no scenario comment explains.

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
    // Scenario (task 261 requirement 1): since task 245 the bubble's visible label is the BASENAME,
    // so the box must accept what the user can see — typing the full `.vscode/settings.json` must
    // not be required.
    // Steps:
    // open a page holding two bubbles whose paths differ but whose basenames do not collide.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    // typing the basename alone lands on the one bubble that owns it.
    jumpToNamedBubble("settings.json");
    assert.deepEqual(scrolledPaths, [".vscode/settings.json"]);
    // the landed bubble is lit so it is obvious which one was targeted (requirement 4).
    assert.equal(document.querySelectorAll(".filebox.found").length, 1);
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("data-path"), ".vscode/settings.json");
    // and the readout names it rather than leaving the jump unreported (requirement 5).
    assert.match(readFindStatusText(), /1 of 1 · \.vscode\/settings\.json/);
});

test("test_a_colliding_basename_cycles_through_every_match_and_wraps", () => {
    // Scenario (requirement 2): `launch.json` names three bubbles in this repo and that is NOT an
    // error — repeat submits walk them in render order, and the fourth wraps to the first rather
    // than sticking on the last.
    // Steps:
    // open the six-bubble collision set and submit the ambiguous basename four times.
    openFoundPage(COLLIDING_PATHS);
    for (let submit = 0; submit < 4; submit++) {
        jumpToNamedBubble("launch.json");
    }
    // each submit landed on the NEXT match, and the fourth wrapped back to the first.
    assert.deepEqual(scrolledPaths, [
        ".claude/launch.json",
        ".vscode/launch.json",
        ".vscode-parent/launch.json",
        ".claude/launch.json",
    ]);
    // the counter says how far through the cycle the viewport is, so an ambiguous term is
    // navigable rather than confusing.
    assert.match(readFindStatusText(), /1 of 3 · \.claude\/launch\.json/);
    // exactly ONE bubble stays lit — the previous match is darkened as the cycle advances.
    assert.equal(document.querySelectorAll(".filebox.found").length, 1);
});

test("test_a_partial_path_narrows_a_colliding_basename_to_one_bubble", () => {
    // Scenario (requirement 2, the bonus): a user who knows WHICH tasks.json they mean can type
    // enough of the path to skip the cycle entirely. One substring rule serves both this and the
    // bare-basename case above, which is why there is no separate path branch in the module.
    // Steps:
    // open the collision set and submit a fragment spanning the directory and the name.
    openFoundPage(COLLIDING_PATHS);
    jumpToNamedBubble(".vscode/tasks");
    // only the one bubble under .vscode matches — .vscode-parent/tasks.json is not a superstring
    // of ".vscode/tasks".
    assert.deepEqual(scrolledPaths, [".vscode/tasks.json"]);
    assert.match(readFindStatusText(), /1 of 1 · \.vscode\/tasks\.json/);
});

test("test_an_unmatched_name_reports_instead_of_doing_nothing", () => {
    // Scenario (requirement 5): a typo must never look like a broken page. Nothing scrolls, nothing
    // lights up, and the crumb says why.
    // Steps:
    // open a populated page and submit a name no bubble carries.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToNamedBubble("no-such-file.txt");
    // no scroll and no highlight — there is nothing to land on.
    assert.deepEqual(scrolledPaths, []);
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    // but the submit is reported, quoting the term back so a typo is visible.
    assert.equal(readFindStatusText(), 'find "no-such-file.txt": no bubble matches');
});

test("test_a_jump_aligns_the_bubbles_top_edge_rather_than_its_middle", () => {
    // Scenario (task 277): a `.filebox` is as tall as its own ladder span, so a file with a long
    // history is thousands of px tall. Centring that box VERTICALLY puts its top — its name, its
    // first node — far above the viewport, which reads as "only the horizontal scroll worked".
    // The horizontal centring is correct and must survive.
    // Steps:
    // open a page and jump to a bubble.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToNamedBubble("settings.json");
    // the scroll aligns the bubble's TOP with the pane's top edge...
    assert.equal(scrolledOptions[0]!.block, "start");
    // ...while still centring it horizontally, which is what put it on screen sideways.
    assert.equal(scrolledOptions[0]!.inline, "center");
});

test("test_an_exact_path_jump_lands_the_same_bubble_however_many_times_it_is_repeated", () => {
    // Scenario (task 278): a File Nav leaf knows the EXACT path it represents, so clicking it twice
    // must land the same bubble twice. Routing a click through the typed box's substring+cycle
    // search made a repeat click advance to the NEXT match instead — and for `.gitignore`, whose
    // root path is a substring of every nested one, no cycle position was ever right.
    // Steps:
    // open the collision set, which holds three bubbles whose paths contain "tasks.json".
    openFoundPage(COLLIDING_PATHS);
    // jump to one of them by its exact path, twice.
    jumpToBubbleAtPath("tasks.json");
    jumpToBubbleAtPath("tasks.json");
    // both jumps landed the SAME bubble — the root one, not .vscode/tasks.json.
    assert.deepEqual(scrolledPaths, ["tasks.json", "tasks.json"]);
    // and exactly that bubble is lit.
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("data-path"), "tasks.json");
});

test("test_an_exact_path_jump_does_not_write_the_find_boxs_counter_into_the_crumb", () => {
    // Scenario (task 278): the user saw `find "<name>": n of N` appear in the header when they
    // clicked a file in the File Nav, and the n climb on every repeat click. A click is not a
    // search, so it must not report as one.
    // Steps:
    // open a page and jump by exact path.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToBubbleAtPath(".vscode/settings.json");
    // the crumb carries no find-counter text.
    assert.doesNotMatch(readCrumbText(), /of \d/);
});

test("test_an_exact_path_with_no_bubble_reports_instead_of_doing_nothing", () => {
    // Scenario (task 278): an orphan path is listed in the File Nav but has NO bubble of its own —
    // it lives in a bucket. Clicking it must say so rather than appearing to do nothing.
    // Steps:
    // open a populated page and jump to a path no bubble carries.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    jumpToBubbleAtPath("src/deleted-long-ago.ts");
    // nothing scrolled and nothing lit.
    assert.deepEqual(scrolledPaths, []);
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    // but the readout names the path and why it has no bubble.
    assert.match(readFindStatusText(), /src\/deleted-long-ago\.ts/);
});

test("test_the_enter_key_on_the_box_is_what_submits", () => {
    // Scenario: the box is wired by bootLayer1Page, and Enter IS the submit — there is no Find
    // button. Driving the KEYSTROKE rather than the exported function is what proves the wiring,
    // which is the half a direct call cannot cover.
    // Steps:
    // open a page, type a basename into the box, and press Enter.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = "reconstruction_cli.ts";
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // the keystroke reached the module and scrolled the named bubble.
    assert.deepEqual(scrolledPaths, ["src/reconstruction_cli.ts"]);
    // a NON-Enter keystroke does not submit — the box would otherwise jump on every character.
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    assert.deepEqual(scrolledPaths, ["src/reconstruction_cli.ts"]);
});

test("test_clearing_the_find_box_clears_its_result_readout", () => {
    // Scenario (task 273): the user reported that emptying the box leaves the last search's
    // "n of N" on screen against a search they have abandoned. Emptying it must clear the readout,
    // darken the found bubble, and reset the cycle so the NEXT term starts at its first match
    // rather than at wherever the abandoned one stopped.
    // Steps:
    // open the collision set and cycle twice, so there is both a lit bubble and a counter showing.
    openFoundPage(COLLIDING_PATHS);
    jumpToNamedBubble("launch.json");
    jumpToNamedBubble("launch.json");
    assert.match(readFindStatusText(), /2 of 3/);
    // empty the box and fire the input event the browser fires on every keystroke.
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = "";
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    // the readout is empty rather than reporting an abandoned search.
    assert.equal(readFindStatusText(), "");
    // no bubble is left lit against that search either.
    assert.equal(document.querySelectorAll(".filebox.found").length, 0);
    // and the cycle restarted: re-typing the same term lands on its FIRST match, not its third.
    jumpToNamedBubble("launch.json");
    assert.equal(scrolledPaths.at(-1), ".claude/launch.json");
});

test("test_the_next_button_steps_forward_through_the_matches", () => {
    // Scenario (task 271): repeat-Enter was the only way to reach match 2 of 3, which is invisible
    // as an affordance. The button must do exactly what Enter does, from the box's current text.
    // Steps:
    // open the collision set, type an ambiguous term, and submit it once with Enter.
    openFoundPage(COLLIDING_PATHS);
    submitTermWithEnter("launch.json");
    // click Next twice.
    clickCycleButton("find-next");
    clickCycleButton("find-next");
    // the two clicks continued the SAME cycle the Enter started, rather than restarting it.
    assert.deepEqual(scrolledPaths, [
        ".claude/launch.json",
        ".vscode/launch.json",
        ".vscode-parent/launch.json",
    ]);
    assert.match(readFindStatusText(), /3 of 3/);
});

test("test_the_previous_button_steps_backward_and_wraps", () => {
    // Scenario (task 271): the user asked for BACKWARD as well as forward — overshooting a match
    // with Enter otherwise means cycling all the way round to reach it again. Stepping back from
    // the first match must wrap to the last, mirroring the forward cycle's wrap.
    // Steps:
    // open the collision set and submit the ambiguous term once, landing on match 1 of 3.
    openFoundPage(COLLIDING_PATHS);
    submitTermWithEnter("launch.json");
    // click Previous once.
    clickCycleButton("find-prev");
    // it wrapped backward to the LAST match rather than sticking on the first.
    assert.equal(scrolledPaths.at(-1), ".vscode-parent/launch.json");
    assert.match(readFindStatusText(), /3 of 3/);
});

test("test_the_find_widget_sits_at_the_end_of_the_jump_bar", () => {
    // Scenario (task 285, user 2026-07-26): the find box was buried among the source paths while
    // the bucket jump buttons sat in the header, so the page's two navigation controls were in two
    // unrelated places. Requested position: to the RIGHT of the last `Jump to:` button.
    // Steps:
    // boot the page.
    openFoundPage([]);
    // the box, its two cycle buttons and its readout all live inside the jump bar.
    const jumpbar = document.querySelector(".jumpbar")!;
    for (const id of ["find-file", "find-prev", "find-next", "find-status"]) {
        assert.ok(jumpbar.contains(document.getElementById(id)), `${id} is not in the jump bar`);
    }
    // and the widget follows the bucket buttons rather than preceding them.
    const children = [...jumpbar.children];
    const lastBucketButton = [...jumpbar.querySelectorAll("[data-bucket]")].at(-1)!;
    const findLabel = document.getElementById("find-file")!.closest("label")!;
    assert.ok(children.indexOf(findLabel) > children.indexOf(lastBucketButton));
});

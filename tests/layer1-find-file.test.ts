// The Layer 1 page's jump-to-bubble box (task 261). The render is 808 widgets across ~156,000 px,
// so the box is what makes "look at the launch.json bubble" a workable handoff.
//
// happy-dom implements NO layout and NO scrolling, so no assertion below reads a scroll position —
// that would be measuring happy-dom rather than the page. Instead scrollIntoView is SPIED on: the
// contract under test is "the right element was asked to centre itself", which is exactly what the
// production code delegates to the browser.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// webapp/layer1-page.ts calls bootLayer1Page() at MODULE SCOPE, so the first import in this process
// wires every listener a SECOND time — and one Enter would then advance the cycle twice. Absorb that
// boot here, against a throwaway DOM (same guard as tests/layer1-zoom.test.ts).
setupLayer1Dom();
const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
const { jumpToBubbleAtPath, jumpToNamedBubble } = await import("../webapp/layer1-find-file.ts");

// What scrollIntoView was called on, in call order, named by the FULL path so a collision test can
// tell the six same-basename bubbles apart.
const scrolledPaths: string[] = [];

// The options each of those calls carried (task 277: which EDGE of the bubble the scroll aligns).
const scrolledOptions: ScrollIntoViewOptions[] = [];

// The spy. Installed on the prototype rather than per element because the bubbles are built fresh
// by each openFoundPage() call, and the page — not the test — owns those elements.
function spyOnScrollIntoView(): void {
    HTMLElement.prototype.scrollIntoView = function recordScroll(this: HTMLElement, options?: unknown): void {
        scrolledPaths.push(this.querySelector(".fname")?.getAttribute("title") ?? "");
        scrolledOptions.push((options ?? {}) as ScrollIntoViewOptions);
    };
}

// One bubble in the same shape buildPairWidget emits: the BASENAME as the visible `.fname` text
// (task 245) and the full path as that element's `title`. The box must match what the user can SEE,
// which is only the basename — so a test fixture that put the full path in the text would prove
// nothing.
function buildStageBubble(path: string): string {
    const basename = path.split("/").pop()!;
    return `<div class="filebox"><div class="fname" title="${path}">${basename}</div></div>`;
}

// A booted page whose stage holds `paths` as bubbles. Booting per test resets the module's cycle
// state along with the DOM, so one test's repeat-submits cannot leak into the next.
function openFoundPage(paths: string[]): void {
    setupLayer1Dom();
    bootLayer1Page();
    spyOnScrollIntoView();
    scrolledPaths.length = 0;
    scrolledOptions.length = 0;
    document.getElementById("stage")!.innerHTML = paths.map(buildStageBubble).join("");
}

function readCrumbText(): string {
    return document.getElementById("crumb")!.textContent ?? "";
}

// The six colliding bubbles the task names as the real case in this repo.
const COLLIDING_PATHS = [
    ".claude/launch.json",
    ".vscode/launch.json",
    ".vscode-parent/launch.json",
    "tasks.json",
    ".vscode/tasks.json",
    ".vscode-parent/tasks.json",
];

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
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("title"), ".vscode/settings.json");
    // and the crumb names it rather than leaving the jump unreported (requirement 5).
    assert.match(readCrumbText(), /1 of 1 · \.vscode\/settings\.json/);
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
    assert.match(readCrumbText(), /1 of 3 · \.claude\/launch\.json/);
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
    assert.match(readCrumbText(), /1 of 1 · \.vscode\/tasks\.json/);
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
    assert.equal(readCrumbText(), 'find "no-such-file.txt": no bubble matches');
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
    assert.equal(document.querySelector(".filebox.found .fname")!.getAttribute("title"), "tasks.json");
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
    // but the crumb names the path and why it has no bubble.
    assert.match(readCrumbText(), /src\/deleted-long-ago\.ts/);
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

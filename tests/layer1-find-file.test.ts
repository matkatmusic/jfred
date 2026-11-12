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

// Type into the find box the way a user does: set the value, then fire the page's `input` handler.
function typeIntoFindBox(text: string): HTMLInputElement {
    const box = document.getElementById("find-file") as HTMLInputElement;
    box.value = text;
    box.dispatchEvent(new window.Event("input", { bubbles: true }));
    return box;
}

function pressKeyInFindBox(box: HTMLInputElement, key: string): void {
    box.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
}

function listSuggestionPaths(): string[] {
    return [...document.querySelectorAll<HTMLElement>("#find-file-results .find-suggestion")].map((row) => row.dataset.path!);
}

function readSelectedSuggestionPath(): string | undefined {
    return document.querySelector<HTMLElement>("#find-file-results .find-suggestion.selected")?.dataset.path;
}

test("test_typing_in_the_find_box_lists_only_the_matching_file_names", () => {
    // Scenario: like the File Nav search box, the find box narrows a list as text is typed.
    openFoundPage(COLLIDING_PATHS);
    // type a substring that three paths hold.
    typeIntoFindBox("launch");
    assert.deepEqual(listSuggestionPaths(), [".claude/launch.json", ".vscode/launch.json", ".vscode-parent/launch.json"]);
    // the match is case-insensitive.
    typeIntoFindBox("TASKS");
    assert.deepEqual(listSuggestionPaths(), ["tasks.json", ".vscode/tasks.json", ".vscode-parent/tasks.json"]);
    // a substring nothing holds empties the list.
    typeIntoFindBox("no-such-file");
    assert.deepEqual(listSuggestionPaths(), []);
    // an emptied box empties the list.
    typeIntoFindBox("");
    assert.deepEqual(listSuggestionPaths(), []);
});

test("test_up_and_down_move_the_selection_through_the_suggestions", () => {
    // Scenario: ArrowDown walks the list forward, ArrowUp walks it back.
    openFoundPage(COLLIDING_PATHS);
    const box = typeIntoFindBox("launch");
    assert.equal(readSelectedSuggestionPath(), undefined);
    pressKeyInFindBox(box, "ArrowDown");
    assert.equal(readSelectedSuggestionPath(), ".claude/launch.json");
    pressKeyInFindBox(box, "ArrowDown");
    assert.equal(readSelectedSuggestionPath(), ".vscode/launch.json");
    pressKeyInFindBox(box, "ArrowUp");
    assert.equal(readSelectedSuggestionPath(), ".claude/launch.json");
});

test("test_enter_on_a_selected_suggestion_fills_the_box_and_runs_the_find", () => {
    // Scenario: the picked path lands in the box and the existing find scrolls to that bubble.
    openFoundPage(COLLIDING_PATHS);
    const box = typeIntoFindBox("launch");
    pressKeyInFindBox(box, "ArrowDown");
    pressKeyInFindBox(box, "ArrowDown");
    pressKeyInFindBox(box, "Enter");
    assert.equal(box.value, ".vscode/launch.json");
    assert.deepEqual(scrolledPaths, [".vscode/launch.json"]);
    assert.deepEqual(listSuggestionPaths(), []);
});

test("test_clicking_a_suggestion_fills_the_box_and_runs_the_find", () => {
    openFoundPage(COLLIDING_PATHS);
    const box = typeIntoFindBox("tasks");
    const rows = document.querySelectorAll<HTMLElement>("#find-file-results .find-suggestion");
    rows[2]!.click();
    assert.equal(box.value, ".vscode-parent/tasks.json");
    assert.deepEqual(scrolledPaths, [".vscode-parent/tasks.json"]);
});

test("test_enter_with_no_selected_suggestion_still_searches_the_typed_text", () => {
    // Scenario: the old Enter-cycles behavior is untouched while nothing is selected.
    openFoundPage(COLLIDING_PATHS);
    const box = typeIntoFindBox("launch.json");
    pressKeyInFindBox(box, "Enter");
    pressKeyInFindBox(box, "Enter");
    assert.deepEqual(scrolledPaths, [".claude/launch.json", ".vscode/launch.json"]);
});

test("test_a_jump_aligns_the_bubbles_top_edge_rather_than_its_middle", () => {
    // A `.filebox` is as tall as its ladder span, so centring puts its top above the viewport.
    openFoundPage([".vscode/settings.json", "src/reconstruction_cli.ts"]);
    moveToNamedBubble("settings.json");
    assert.equal(scrolledOptions[0]!.block, "start");
    assert.equal(scrolledOptions[0]!.inline, "center");
});

// Task 385: the Layer 8 show row mockup renders one checkbox per node kind present in the loaded view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installRecordingFetch } from "./layer1-drawer-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };
const TOOL_NODE = { ...INSTANT, id: "l7-tool-0", kind: "tool_use", pairId: "toolu_fixture_l7_grep", label: "Grep" };

function renderViewAndListShownKinds(pair: object | undefined): string[] {
    initLayer1Dom();
    initLayer1Page();
    renderLayer1View({ pairs: pair === undefined ? [] : [pair], gitOrphans: [], diskOrphans: [], ruler: [] } as never);
    return [...document.querySelectorAll<HTMLInputElement>("#show-row input[type=checkbox]")]
        .map((box) => box.dataset["kind"]!);
}

test("test_the_show_row_lists_a_checkbox_for_each_kind_the_view_draws", () => {
    // Scenario: four node kinds in the pair give four boxes, plus the always-present edit, script-run and branch boxes.
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, created: INSTANT, snapshots: [SNAPSHOT] };
    assert.deepEqual(renderViewAndListShownKinds(pair), ["created", "commit", "disk", "snapshot", "edit", "script-run", "branch"]);
});

test("test_the_show_row_omits_kinds_the_view_does_not_draw", () => {
    // Scenario: a commit-and-disk pair shows no created-at and no snapshot box; the edit and script-run boxes stay.
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT };
    assert.deepEqual(renderViewAndListShownKinds(pair), ["commit", "disk", "edit", "script-run", "branch"]);
});

test("test_the_edit_and_script_run_boxes_exist_even_when_the_view_has_no_pairs", () => {
    // Scenario: the boxes must exist before their data does, so an empty view still prints them.
    assert.deepEqual(renderViewAndListShownKinds(undefined), ["edit", "script-run", "branch"]);
});

test("test_the_show_row_boxes_start_checked_except_edit_and_script_run_and_the_legend_is_gone", () => {
    // Scenario: every box starts checked except edit and script-run; the static legend no longer renders.
    renderViewAndListShownKinds({ path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT });
    const boxes = [...document.querySelectorAll<HTMLInputElement>("#show-row input")];
    assert.ok(boxes.filter((box) => !["edit", "script-run", "branch"].includes(box.dataset["kind"]!)).every((box) => box.checked));
    assert.equal(boxes.find((box) => box.dataset["kind"] === "branch")!.checked, false);
    assert.equal(boxes.find((box) => box.dataset["kind"] === "edit")!.checked, false);
    assert.equal(boxes.find((box) => box.dataset["kind"] === "script-run")!.checked, false);
    assert.equal(document.querySelector(".legend"), null);
});

function renderViewWithExtras(extras: object, pairExtras: object): void {
    initLayer1Dom();
    initLayer1Page();
    const pair = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, ...pairExtras };
    // A view with annotations makes the engineV3 bar fetch its steps.
    installRecordingFetch(() => ({ steps: [] }));
    renderLayer1View({ pairs: [pair], gitOrphans: [], diskOrphans: [], ruler: [], ...extras } as never);
}

test("test_a_view_with_annotations_shows_the_hide_ignored_box_after_the_kind_columns", () => {
    // Scenario: the box is the last child of the show row and carries the exact label.
    renderViewWithExtras({ annotations: [] }, {});
    const lastChild = document.getElementById("show-row")!.lastElementChild!;
    assert.equal(lastChild.querySelector("#hide-ignored")?.id, "hide-ignored");
    assert.equal(lastChild.textContent!.trim(), "hide ignored nodes");
    assert.equal(document.querySelectorAll("#show-row #hide-ignored").length, 1);
});

test("test_a_view_without_annotations_shows_no_hide_ignored_box", () => {
    // Scenario: real data never sets annotations, so the show row and the viz root stay as before.
    renderViewWithExtras({}, {});
    assert.equal(document.getElementById("hide-ignored"), null);
    assert.equal(document.querySelector(".viz-root")!.hasAttribute("data-hide-ignored"), false);
});

test("test_a_view_with_tool_nodes_lists_the_tool_kind_last", () => {
    // Scenario: one pair with a tool node adds a tool box after the branch box.
    renderViewWithExtras({}, { toolNodes: [TOOL_NODE] });
    const kinds: string[] = [];
    for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
        kinds.push(box.dataset["kind"]!);
    }
    assert.deepEqual(kinds,["commit", "disk", "edit", "script-run", "branch", "tool"]);
    assert.equal(document.querySelector<HTMLInputElement>("#show-row input[data-kind=tool]")!.checked, true);
});

test("test_a_view_without_tool_nodes_lists_the_old_kinds_unchanged", () => {
    // Scenario: no pair has toolNodes, so there is no tool box.
    renderViewWithExtras({}, {});
    assert.equal(document.querySelector("#show-row input[data-kind=tool]"), null);
});

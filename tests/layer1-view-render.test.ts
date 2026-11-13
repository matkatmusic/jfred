// The Layer 1 view render's folder-selection filter helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { WireReverseKind, type WireReverseWalk } from "../webapp/layer1-wire-reverse.ts";

initLayer1Dom();
const { clearFolderFilterState, getIntersectedFilterTargets, renderLayer1View } = await import("../webapp/layer1-view-render.ts");

test("test_two_idle_pickers_do_not_filter", () => {
    assert.equal(getIntersectedFilterTargets([], []), undefined);
});

test("test_one_idle_picker_passes_the_other_through", () => {
    assert.deepEqual(getIntersectedFilterTargets(["a.ts"], []), ["a.ts"]);
    assert.deepEqual(getIntersectedFilterTargets([], ["b.ts"]), ["b.ts"]);
});

test("test_two_active_pickers_keep_only_shared_paths", () => {
    assert.deepEqual(getIntersectedFilterTargets(["a.ts", "b.ts"], ["b.ts", "c.ts"]), ["b.ts"]);
    assert.deepEqual(getIntersectedFilterTargets(["a.ts"], ["c.ts"]), []);
});

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const FULL_VIEW = {
    pairs: [
        { path: "src/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
        { path: "src/b.ts", commits: [{ hash: "ba", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
    ],
    gitOrphans: [],
    diskOrphans: [],
    ruler: [{ instant: T0, axisPx: 0, eventCount: 2 }, { instant: T1, axisPx: 22, eventCount: 2 }],
};
const WALK_OF_A: WireReverseWalk = {
    path: "src/a.ts",
    states: [
        { index: 0, kind: WireReverseKind.DiskNow, content: "now" },
        { index: 1, kind: WireReverseKind.EditUndone, instant: T0, content: "before" },
    ],
};
const toggle = await import("../webapp/layer1-components/top-bars/layer1-reverse-toggle.ts");
const reverseStore = await import("../webapp/layer1-reverse-store.ts");

function openPageWithReverseStreamRoute(): string[] {
    initLayer1Dom();
    clearFolderFilterState();
    reverseStore.clearReverseWalks();
    toggle.resetReverseToggle();
    toggle.installReverseToggle();
    installStreamRoute("/api/layer1-reverse", [WALK_OF_A]);
    const reverseUrls: string[] = [];
    const inner = globalThis.fetch;
    Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
        if (String(url).includes("/api/layer1-reverse")) {
            reverseUrls.push(String(url));
        }
        return inner(url as string, init);
    } });
    renderLayer1View(FULL_VIEW as never);
    return reverseUrls;
}

function selectFiles(...paths: string[]): void {
    for (const path of paths) {
        const row = document.querySelector<HTMLElement>(`#filenav-tree .file-item[title="${path}"]`)!;
        row.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    }
}

function clickReverseToggle(): void {
    document.getElementById("reverse-toggle")!.click();
}

function listStageFilePaths(): (string | undefined)[] {
    return [...document.querySelectorAll<HTMLElement>("#fileBubbleContainer .filebox .fname")].map((name) => name.dataset.path).sort();
}

async function waitForReverseLoad(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30));
}

test("test_reverse_on_with_one_file_and_a_stored_walk_draws_only_the_reverse_bubble", () => {
    // Scenario: reverse is on, one file is selected, its walk is already stored: the stage holds only that file's states.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    assert.deepEqual(listStageFilePaths(), ["src/a.ts"]);
    assert.equal(document.querySelectorAll("#fileBubbleContainer .node.n-rev").length, 2);
    assert.equal(document.querySelectorAll("#fileBubbleContainer .node.n-disk").length, 0);
});

test("test_reverse_stage_ruler_has_one_tick_per_node_at_the_node_offset", () => {
    // Scenario: reverse is on with a stored walk: the gutter holds one tick per node, each at its node's offset.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    const tickOffsets = [...document.querySelectorAll<HTMLElement>("#timelineRulerComponent .tick")].map((tick) => tick.style.getPropertyValue("--axis-px"));
    const nodeOffsets = [...document.querySelectorAll<HTMLElement>("#fileBubbleContainer .node.n-rev")].map((node) => node.style.getPropertyValue("--axis-px"));
    assert.deepEqual(tickOffsets, nodeOffsets);
    assert.equal(tickOffsets.length, 2);
});

test("test_reverse_stage_ruler_reads_now_then_the_instant", () => {
    // Scenario: the DiskNow node has no instant, so its tick reads "now"; the other tick reads its instant.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    const tickTexts = [...document.querySelectorAll<HTMLElement>("#timelineRulerComponent .tick")].map((tick) => tick.textContent);
    assert.deepEqual(tickTexts, ["now", "07-01 10:00:00.000"]);
});

test("test_clicking_a_reverse_stage_tick_lights_its_node", () => {
    // Scenario: a tick click in reverse mode jumps to and lights the node at the tick's offset.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    document.querySelectorAll<HTMLElement>("#timelineRulerComponent .tick")[1]!.click();
    const litIndexes = [...document.querySelectorAll<HTMLElement>("#fileBubbleContainer .node.n-rev.found")].map((node) => node.dataset.index);
    assert.deepEqual(litIndexes, ["1"]);
});

test("test_reverse_on_with_one_file_and_no_stored_walk_keeps_the_normal_stage_and_starts_one_load", async () => {
    // Scenario: the walk is missing, so the normal stage stays; selecting again while the load runs does not start a second load.
    const reverseUrls = openPageWithReverseStreamRoute();
    clickReverseToggle();
    selectFiles("src/a.ts");
    assert.deepEqual(listStageFilePaths(), ["src/a.ts", "src/b.ts"]);
    assert.equal(reverseUrls.length, 1);
    selectFiles("src/a.ts", "src/a.ts");
    assert.equal(reverseUrls.length, 1);
    await waitForReverseLoad();
});

test("test_when_the_load_ends_the_stage_redraws_with_the_reverse_bubble", async () => {
    // Scenario: after the walk arrives, the same selection is redrawn as the reverse bubble.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    selectFiles("src/a.ts");
    await waitForReverseLoad();
    assert.deepEqual(listStageFilePaths(), ["src/a.ts"]);
    assert.equal(document.querySelectorAll("#fileBubbleContainer .node.n-rev").length, 2);
});

test("test_a_load_that_ends_after_the_selection_moved_draws_the_new_selection", async () => {
    // Scenario: the user moves to two files while the load runs: the late answer redraws the normal stage, not the old bubble.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    selectFiles("src/a.ts");
    selectFiles("src/b.ts");
    await waitForReverseLoad();
    assert.deepEqual(listStageFilePaths(), ["src/a.ts", "src/b.ts"]);
});

test("test_reverse_on_with_two_files_selected_keeps_the_normal_stage_and_loads_nothing", () => {
    // Scenario: a multi-selection is not a reverse target.
    const reverseUrls = openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts", "src/b.ts");
    assert.deepEqual(listStageFilePaths(), ["src/a.ts", "src/b.ts"]);
    assert.equal(reverseUrls.length, 0);
});

test("test_reverse_on_with_no_file_selected_keeps_the_normal_stage", () => {
    // Scenario: turning reverse on with nothing selected changes nothing.
    const reverseUrls = openPageWithReverseStreamRoute();
    clickReverseToggle();
    assert.deepEqual(listStageFilePaths(), ["src/a.ts", "src/b.ts"]);
    assert.equal(reverseUrls.length, 0);
});

test("test_reverse_off_with_one_file_and_a_stored_walk_keeps_the_normal_stage", () => {
    // Scenario: with reverse off, a stored walk is ignored.
    openPageWithReverseStreamRoute();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    assert.deepEqual(listStageFilePaths(), ["src/a.ts", "src/b.ts"]);
    assert.equal(document.querySelectorAll("#fileBubbleContainer .node.n-rev").length, 0);
});

test("test_turning_reverse_off_redraws_the_normal_stage", () => {
    // Scenario: flip on (bubble), flip off (normal stage again).
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    assert.deepEqual(listStageFilePaths(), ["src/a.ts"]);
    clickReverseToggle();
    assert.deepEqual(listStageFilePaths(), ["src/a.ts", "src/b.ts"]);
});

test("test_flipping_reverse_forgets_stored_walks", async () => {
    // Scenario: a flip clears the store, so turning reverse on with one file selected starts a fresh load.
    const reverseUrls = openPageWithReverseStreamRoute();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    clickReverseToggle();
    assert.equal(reverseStore.readReverseWalk("src/a.ts"), undefined);
    assert.equal(reverseUrls.length, 1);
    await waitForReverseLoad();
});

test("test_a_reverse_selection_does_not_open_the_forward_drawer", () => {
    // Scenario: a click that selects the reverse target leaves the details drawer closed; forward mode opens it.
    openPageWithReverseStreamRoute();
    selectFiles("src/b.ts");
    assert.ok(document.getElementById("detailsPaneContainer")!.classList.contains("open"));
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    assert.equal(document.getElementById("detailsPaneContainer")!.classList.contains("open"), false);
});

test("test_rendering_the_view_again_keeps_the_reverse_bubble_for_the_remembered_selection", () => {
    // Scenario: the initial draw also shows the reverse bubble when a one-file selection and a stored walk already exist.
    openPageWithReverseStreamRoute();
    clickReverseToggle();
    reverseStore.storeReverseWalk(WALK_OF_A);
    selectFiles("src/a.ts");
    renderLayer1View(FULL_VIEW as never);
    assert.deepEqual(listStageFilePaths(), ["src/a.ts"]);
    assert.equal(document.querySelectorAll("#fileBubbleContainer .node.n-rev").length, 2);
});

test("test_clearing_the_filter_state_forgets_stored_walks", () => {
    // Scenario: a fresh project starts with no stored reverse walk.
    initLayer1Dom();
    reverseStore.storeReverseWalk(WALK_OF_A);
    clearFolderFilterState();
    assert.equal(reverseStore.readReverseWalk("src/a.ts"), undefined);
});

test("test_clearing_the_filter_state_drops_the_only_selected_highlight", () => {
    // Scenario: a fresh project must not start with the only-selected button lit.
    initLayer1Dom();
    const button = document.getElementById("filenav-only-selected") ?? document.body.appendChild(document.createElement("button"));
    button.id = "filenav-only-selected";
    button.classList.add("current");
    clearFolderFilterState();
    assert.equal(button.classList.contains("current"), false);
});

// The reverse bubble's "Show only modifying events for File" toggle on the rendered Layer 1 page: it dims nodes and never moves them.
// Split from layer1-view-render.test.ts to keep that file under 250 lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";
import { WireReverseKind, type WireReverseWalk } from "../webapp/layer1-wire-reverse.ts";

initLayer1Dom();
const { clearFolderFilterState, renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const reverseToggle = await import("../webapp/layer1-components/top-bars/layer1-reverse-toggle.ts");
const modifyingToggle = await import("../webapp/layer1-components/top-bars/layer1-reverse-modifying-toggle.ts");
const reverseStore = await import("../webapp/layer1-reverse-store.ts");

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
const MIXED_WALK_OF_A: WireReverseWalk = {
    path: "src/a.ts",
    states: [
        { index: 0, kind: WireReverseKind.DiskNow, content: "now" },
        { index: 1, kind: WireReverseKind.ReadOnly, instant: T1, content: "now", isModifying: false },
        { index: 2, kind: WireReverseKind.EditUndone, instant: T0, content: "before", isModifying: true },
    ],
};

function openPageWithMixedWalkStored(): void {
    initLayer1Dom();
    clearFolderFilterState();
    reverseStore.clearReverseWalks();
    reverseToggle.resetReverseToggle();
    reverseToggle.installReverseToggle();
    modifyingToggle.installReverseModifyingToggle();
    installStreamRoute("/api/layer1-reverse", [MIXED_WALK_OF_A]);
    renderLayer1View(FULL_VIEW as never);
}

function drawMixedReverseBubble(): void {
    openPageWithMixedWalkStored();
    clickReverseToggle();
    reverseStore.storeReverseWalk(MIXED_WALK_OF_A);
    const row = document.querySelector<HTMLElement>(`#filenav-tree .file-item[title="src/a.ts"]`)!;
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
}

function clickReverseToggle(): void {
    document.getElementById("reverse-toggle")!.click();
}

function clickModifyingToggle(): void {
    const checkbox = document.querySelector<HTMLInputElement>("#reverse-modifying-only input")!;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function readModifyingButton(): HTMLLabelElement {
    return document.getElementById("reverse-modifying-only") as HTMLLabelElement;
}

function listReverseNodes(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("#stage .node.n-rev")];
}

function listNodeAxisPositions(): string[] {
    return listReverseNodes().map((node) => node.style.getPropertyValue("--axis-px"));
}

test("test_the_modifying_only_button_is_hidden_while_reverse_is_off", () => {
    // Scenario: after the page draws with reverse off, the button stays hidden.
    openPageWithMixedWalkStored();
    assert.equal(readModifyingButton().hidden, true);
});

test("test_the_modifying_only_button_shows_when_reverse_turns_on_and_hides_when_it_turns_off", () => {
    // Scenario: reverse on shows the button; reverse off hides it again.
    openPageWithMixedWalkStored();
    clickReverseToggle();
    assert.equal(readModifyingButton().hidden, false);
    clickReverseToggle();
    assert.equal(readModifyingButton().hidden, true);
});

test("test_the_modifying_only_button_is_shown_on_the_initial_draw_when_reverse_is_already_on", () => {
    // Scenario: reverse is on before the view renders: the initial draw shows the button.
    openPageWithMixedWalkStored();
    clickReverseToggle();
    renderLayer1View(FULL_VIEW as never);
    assert.equal(readModifyingButton().hidden, false);
    clickReverseToggle();
});

test("test_the_bubble_draws_every_node_with_the_toggle_off", () => {
    // Scenario: with the toggle off, all three states are drawn and none is marked as dimmed.
    drawMixedReverseBubble();
    assert.equal(listReverseNodes().length, 3);
    assert.equal(document.querySelector(".viz-root")!.classList.contains("reverse-modifying-only"), false);
});

test("test_with_the_toggle_on_the_non_modifying_node_is_marked_for_dimming_and_the_modifying_nodes_are_not", () => {
    // Scenario: toggle on: the page carries the dim class; only the ReadOnly node says data-modifying false.
    drawMixedReverseBubble();
    clickModifyingToggle();
    assert.equal(document.querySelector(".viz-root")!.classList.contains("reverse-modifying-only"), true);
    const modifyingFlags = listReverseNodes().map((node) => node.dataset.modifying);
    assert.deepEqual(modifyingFlags, ["true", "false", "true"]);
    clickModifyingToggle();
});

test("test_the_toggle_keeps_the_node_count_and_every_node_position", () => {
    // Scenario: record count and positions with the toggle off, switch it on, and see the same count and positions.
    drawMixedReverseBubble();
    const countBefore = listReverseNodes().length;
    const positionsBefore = listNodeAxisPositions();
    clickModifyingToggle();
    assert.equal(listReverseNodes().length, countBefore);
    assert.equal(listNodeAxisPositions().join(","), positionsBefore.join(","));
    clickModifyingToggle();
});

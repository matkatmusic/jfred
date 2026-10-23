// The show row's < and > arrows under each kind box jump the timeline to the nearest node of that kind.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById } from "../webapp/app-dom.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
setupLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-page.ts");
const { refreshKindJumpArrows } = await import("../webapp/layer1-kind-jump.ts");

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const COMMIT = { ...INSTANT, hash: "b7c8d9e0f1a23445566778899aabbccddeeff001" };
const SNAPSHOT = { ...INSTANT, version: 1, sessionId: "s-1", sessionFile: "alpha.jsonl" };
const PAIR = { path: "src/run.ts", commits: [COMMIT], onDisk: INSTANT, snapshots: [SNAPSHOT] };
const VIEW = { pairs: [PAIR], gitOrphans: [], diskOrphans: [], ruler: [] } as never;

const PANE_HEIGHT_PX = 300;
const NODE_HEIGHT_PX = 10;

// The pane's scroll offset in content pixels; a node's on-screen box is its content y minus this.
let viewTopPx = 0;

// Mimics `block: "nearest"`: a visible node stays put, a hidden one comes to the nearest edge.
function scrollNodeIntoNearestView(centerY: number): void {
    if (centerY < viewTopPx) {
        viewTopPx = centerY - NODE_HEIGHT_PX / 2;
    } else if (centerY > viewTopPx + PANE_HEIGHT_PX) {
        viewTopPx = centerY + NODE_HEIGHT_PX / 2 - PANE_HEIGHT_PX;
    }
}

function buildNode(className: string, centerY: number): HTMLElement {
    const node = el("i", { class: `node ${className}`, "data-y": String(centerY) });
    Object.assign(node, {
        getBoundingClientRect: () => ({ top: centerY - viewTopPx - NODE_HEIGHT_PX / 2, height: NODE_HEIGHT_PX }),
        scrollIntoView: () => scrollNodeIntoNearestView(centerY),
    });
    return node;
}

async function renderViewWithSyntheticStage(): Promise<void> {
    setupLayer1Dom();
    getInputById("dir").value = "";
    viewTopPx = 0;
    await renderLayer1View(VIEW);
    Object.assign(document.getElementById("timelines")!, {
        getBoundingClientRect: () => ({ top: 0, height: PANE_HEIGHT_PX }),
    });
    document.getElementById("stage")!.replaceChildren(
        buildNode("n-commit", 100), buildNode("n-commit", 400), buildNode("n-commit", 700),
        buildNode("n-snap", 50), buildNode("n-snap", 550),
    );
    refreshKindJumpArrows();
}

function findArrow(kind: string, direction: string): HTMLButtonElement {
    return document.querySelector<HTMLButtonElement>(`#show-row [data-jump-kind=${kind}][data-jump=${direction}]`)!;
}

function readLandedY(): string {
    return document.querySelector<HTMLElement>("#stage .found")!.dataset["y"]!;
}

test("test_each_kind_box_has_a_previous_and_a_next_arrow_under_it", async () => {
    await renderViewWithSyntheticStage();
    for (const box of document.querySelectorAll<HTMLInputElement>("#show-row input[data-kind]")) {
        const column = box.closest(".show-kind-col")!;
        const labelRow = column.querySelector("label.show-kind")!;
        const arrows = [...column.querySelectorAll<HTMLButtonElement>("button")];
        assert.deepEqual(arrows.map((arrow) => arrow.textContent), ["<", ">"]);
        assert.ok(arrows.every((arrow) => arrow.type === "button"));
        assert.equal(labelRow.querySelector("input"), box);
        assert.ok(arrows.every((arrow) => !labelRow.contains(arrow)));
    }
});

test("test_next_lands_on_the_nearest_node_after_the_view_and_a_second_next_steps_further", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "400");
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "700");
});

test("test_previous_steps_back_from_the_landed_node", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    findArrow("commit", "next").click();
    findArrow("commit", "previous").click();
    assert.equal(readLandedY(), "400");
    findArrow("commit", "previous").click();
    assert.equal(readLandedY(), "100");
});

test("test_after_the_user_scrolls_the_pane_an_arrow_steps_from_the_view_centre_not_the_landed_node", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(readLandedY(), "400");
    document.getElementById("timelines")!.scrollTop = 500;
    viewTopPx = 500;
    findArrow("commit", "previous").click();
    assert.equal(readLandedY(), "400");
});

test("test_an_arrow_with_no_node_in_its_direction_is_disabled", async () => {
    await renderViewWithSyntheticStage();
    assert.equal(findArrow("commit", "previous").disabled, false);
    findArrow("commit", "next").click();
    findArrow("commit", "next").click();
    assert.equal(findArrow("commit", "next").disabled, true);
    assert.equal(findArrow("commit", "previous").disabled, false);
});

test("test_a_kind_jump_does_not_toggle_the_checkbox", async () => {
    await renderViewWithSyntheticStage();
    findArrow("commit", "next").click();
    assert.equal(document.querySelector<HTMLInputElement>("#show-row input[data-kind=commit]")!.checked, true);
});

test("test_the_arrows_are_disabled_for_a_kind_with_no_nodes_and_for_a_hidden_kind", async () => {
    await renderViewWithSyntheticStage();
    for (const direction of ["previous", "next"]) {
        assert.equal(findArrow("disk", direction).disabled, true);
        assert.equal(findArrow("script-run", direction).disabled, true);
        assert.equal(findArrow("snapshot", direction).disabled, false);
    }
    const box = document.querySelector<HTMLInputElement>("#show-row input[data-kind=snapshot]")!;
    box.checked = false;
    box.dispatchEvent(new window.Event("change", { bubbles: true }));
    for (const direction of ["previous", "next"]) {
        assert.equal(findArrow("snapshot", direction).disabled, true);
    }
});

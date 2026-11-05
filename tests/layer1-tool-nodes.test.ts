// Task 382: a tool call naming a file draws two tool nodes and one bracket on its lane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installAnimationFrameStub, installRecordingFetch } from "./layer1-drawer-test-helpers.ts";
import { WireRecordKind, type WireToolNode } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

initLayer1Dom();
const { installNodeDrawer } = await import("../webapp/layer1-components/details-drawer/layer1-drawer.ts");
const { appendToolNodes } = await import("../webapp/layer1-components/bubbles/layer1-tool-nodes.ts");

const TOOL_USE: WireToolNode = {
    id: "l7-tool-0", kind: WireRecordKind.toolUse, pairId: "toolu_fixture_l7_grep", label: 'Grep "dispatch"',
    instant: "2026-07-21T10:00:00.000Z", axisPx: 400,
};
const TOOL_RESULT: WireToolNode = {
    id: "l7-tool-1", kind: WireRecordKind.toolResult, pairId: "toolu_fixture_l7_grep", label: "4 matches",
    instant: "2026-07-22T10:00:00.000Z", axisPx: 520,
};

function buildLaneWithToolNodes(startPx: number): HTMLElement {
    const lane = createElement("div", { class: "lane" });
    appendToolNodes(lane, [TOOL_USE, TOOL_RESULT], startPx);
    return lane;
}

test("test_one_pair_gives_two_nodes_two_labels_and_one_bracket", () => {
    // Scenario: a use and a result with one pairId draw 2 dots, 2 labels and 1 bracket.
    const lane = buildLaneWithToolNodes(300);
    assert.equal(lane.querySelectorAll(".tnode").length, 2);
    assert.equal(lane.querySelectorAll(".tlabel").length, 2);
    assert.equal(lane.querySelectorAll(".tbracket").length, 1);
    assert.equal(lane.querySelector(".tbracket")!.getAttribute("data-pair-id"), "toolu_fixture_l7_grep");
});

test("test_positions_are_axisPx_minus_startPx", () => {
    // Scenario: axisPx 400 and 520 with startPx 300 sit at 100 and 220; the bracket spans 120.
    const lane = buildLaneWithToolNodes(300);
    const dots = lane.querySelectorAll<HTMLElement>(".tnode");
    assert.equal(dots[0]!.style.getPropertyValue("--axis-px"), "100");
    assert.equal(dots[1]!.style.getPropertyValue("--axis-px"), "220");
    const bracket = lane.querySelector<HTMLElement>(".tbracket")!;
    assert.equal(bracket.style.getPropertyValue("--axis-px"), "100");
    assert.equal(bracket.style.getPropertyValue("--span-px"), "120");
});

test("test_each_node_takes_its_kind_class_and_never_the_edit_classes", () => {
    // Scenario: the use is a-tool-use, the result is a-tool-result; no node, n-read or n-edit class exists.
    const lane = buildLaneWithToolNodes(300);
    const dots = lane.querySelectorAll<HTMLElement>(".tnode");
    assert.ok(dots[0]!.classList.contains("a-tool-use"));
    assert.ok(dots[1]!.classList.contains("a-tool-result"));
    assert.equal(lane.querySelector(".node, .n-read, .n-edit, .nlabel"), null);
});

test("test_each_node_carries_its_identity_and_the_label_text", () => {
    // Scenario: the dot and its label both carry the record id, kind, pair id and instant.
    const lane = buildLaneWithToolNodes(300);
    const dot = lane.querySelector<HTMLElement>(".tnode")!;
    const label = lane.querySelector<HTMLElement>(".tlabel")!;
    for (const element of [dot, label]) {
        assert.equal(element.getAttribute("data-record-id"), "l7-tool-0");
        assert.equal(element.getAttribute("data-record-kind"), WireRecordKind.toolUse);
        assert.equal(element.getAttribute("data-pair-id"), "toolu_fixture_l7_grep");
        assert.equal(element.getAttribute("data-instant"), "2026-07-21T10:00:00.000Z");
    }
    assert.equal(label.textContent, '[t] Grep "dispatch"');
    assert.equal(lane.querySelectorAll<HTMLElement>(".tlabel")[1]!.textContent, "[r] 4 matches");
});

test("test_no_tool_nodes_draw_nothing", () => {
    // Scenario: an empty list leaves the lane empty.
    const lane = createElement("div", { class: "lane" });
    appendToolNodes(lane, [], 0);
    assert.equal(lane.children.length, 0);
});

test("test_a_click_on_a_tool_node_or_label_opens_no_drawer", () => {
    // Scenario: the drawer stays shut and no file is fetched.
    initLayer1Dom();
    installAnimationFrameStub();
    const asks = installRecordingFetch(() => ({ content: "" }));
    const lane = buildLaneWithToolNodes(300);
    getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", "data-path": "src/run.ts" }),
        lane,
    ]));
    installNodeDrawer();
    for (const target of [lane.querySelector<HTMLElement>(".tnode")!, lane.querySelector<HTMLElement>(".tlabel")!]) {
        target.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    }
    assert.equal(getRequiredElementById("drawer").classList.contains("open"), false);
    assert.equal(asks.length, 0);
});

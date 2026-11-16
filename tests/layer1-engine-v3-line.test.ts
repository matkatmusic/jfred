// The engineV3 line: position, visibility, scrolling and color.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRequiredElementById } from "../webapp/app-dom.ts";
// import { renderEngineV3Line, renderEngineV3LineAtTicks, moveEngineV3LineIntoView } from "../webapp/layer1-components/engine-v3/layer1-engine-v3-line.ts";
import { renderEngineV3Line, renderEngineV3LineAtTicks, moveEngineV3LineIntoView, placeEngineV3LineLeftEdge, computeEngineV3LineLeftEdgePx } from "../webapp/layer1-components/engine-v3/layer1-engine-v3-line.ts";
import { clearFileBubbles } from "../webapp/layer1-components/bubbles/layer1-file-bubbles-clear.ts";
import { CURRENT_NODE_CLASS, moveMarkerForward, storeEngineV3Steps } from "../webapp/layer1-components/engine-v3/layer1-engine-v3-state.ts";
import { EngineV3StepKind, type WireEngineV3Step } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { applyZoom } from "../webapp/layer1-components/top-bars/layer1-zoom.ts";

const TICKS: WireRulerTick[] = [
    { instant: "2026-06-01T09:00:00.000Z", axisPx: 100, eventCount: 1 },
    { instant: "2026-06-01T10:00:00.000Z", axisPx: 300, eventCount: 1 },
];

function buildStep(nodeTime: string): WireEngineV3Step {
    return { nodeId: "a1b2c3d4", nodeTime, kind: EngineV3StepKind.commit, filesChanged: [], sentence: "x" };
}

function buildStepOfKind(nodeTime: string, kind: EngineV3StepKind): WireEngineV3Step {
    return { ...buildStep(nodeTime), kind };
}

function readLine(): HTMLElement {
    return getRequiredElementById("engine-v3-line");
}

function readCssFile(path: string): string {
    return readFileSync(new URL(`../webapp/layer1-components/${path}`, import.meta.url), "utf8");
}

function readLineColorVariable(css: string, selector: string, property: string): string {
    const rule = css.slice(css.indexOf(selector));
    return /var\((--[a-z0-9-]+)/.exec(rule.slice(rule.indexOf(property)))![1]!;
}

test("test_the_line_sits_at_the_axis_position_of_the_step_time", () => {
    // Steps: step at the second tick, draw the line, expect the second tick's offset.
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().style.getPropertyValue("--axis-px"), "300");
    assert.equal(readLine().hidden, false);
});

test("test_a_step_between_two_ticks_gets_the_offset_between_them", () => {
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T09:30:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().style.getPropertyValue("--axis-px"), "200");
});

test("test_the_line_shows_when_the_session_column_is_off", () => {
    // Steps: the page has no Session track, draw the line, expect it shown.
    initLayer1Dom();
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    storeEngineV3Steps([buildStep("2026-06-01T09:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().hidden, false);
});

test("test_the_line_has_no_label", () => {
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T09:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().textContent, "");
});

test("test_the_line_is_hidden_when_there_are_no_steps", () => {
    initLayer1Dom();
    storeEngineV3Steps([]);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().hidden, true);
});

test("test_the_line_moves_when_the_marker_moves_and_a_redraw_keeps_one_line", () => {
    // Steps: two steps, draw, move the marker forward, draw again with the same ticks, expect one moved line.
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T09:00:00.000Z"), buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    moveMarkerForward();
    renderEngineV3Line();
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(document.querySelectorAll("#engine-v3-line").length, 1);
    assert.equal(readLine().style.getPropertyValue("--axis-px"), "300");
});

function stubRects(pane: { top: number; bottom: number }, line: { top: number; bottom: number }): { scrolls: unknown[] } {
    const scrolls: unknown[] = [];
    getRequiredElementById("timelineContainer").getBoundingClientRect = () => pane as DOMRect;
    readLine().getBoundingClientRect = () => line as DOMRect;
    readLine().scrollIntoView = (options?: unknown) => scrolls.push(options);
    return { scrolls };
}

test("test_the_line_scrolls_into_view_when_it_is_off_screen", () => {
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    const { scrolls } = stubRects({ top: 0, bottom: 800 }, { top: 2000, bottom: 2002 });
    moveEngineV3LineIntoView();
    assert.equal(scrolls.length, 1);
});

test("test_the_line_does_not_scroll_when_it_is_on_screen", () => {
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    const { scrolls } = stubRects({ top: 0, bottom: 800 }, { top: 400, bottom: 402 });
    moveEngineV3LineIntoView();
    assert.equal(scrolls.length, 0);
});

const HIDES_LINE_CLASS = "hides-engine-v3-line";

function appendBubbleWithNode(container: HTMLElement, bubbleAxisPx: number, nodeAxisPx: number): HTMLElement {
    const bubble = document.createElement("div");
    bubble.className = "filebox";
    bubble.style.setProperty("--axis-px", String(bubbleAxisPx));
    const node = document.createElement("i");
    node.className = "node";
    node.style.setProperty("--axis-px", String(nodeAxisPx));
    bubble.append(node);
    container.append(bubble);
    return bubble;
}

test("test_a_bubble_whose_node_the_line_crosses_hides_the_line", () => {
    // Steps: line at axis px 300, bubble A starts at 250 with a node at 50 (drawn at 300), bubble B starts at 0 with a node at 500, draw, expect only A marked.
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    const container = getRequiredElementById("fileBubbleContainer");
    const bubbleA = appendBubbleWithNode(container, 250, 50);
    const bubbleB = appendBubbleWithNode(container, 0, 500);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().style.getPropertyValue("--axis-px"), "300");
    assert.equal(bubbleA.classList.contains(HIDES_LINE_CLASS), true);
    assert.equal(bubbleB.classList.contains(HIDES_LINE_CLASS), false);
    clearFileBubbles(container);
});

test("test_when_the_line_moves_off_a_node_its_bubble_no_longer_hides_the_line", () => {
    // Steps: same bubbles, first step at axis px 300 marks A, move the marker to the step at axis px 100 (no node there), draw again, expect neither marked.
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z"), buildStep("2026-06-01T09:00:00.000Z")]);
    const container = getRequiredElementById("fileBubbleContainer");
    const bubbleA = appendBubbleWithNode(container, 250, 50);
    const bubbleB = appendBubbleWithNode(container, 0, 500);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(bubbleA.classList.contains(HIDES_LINE_CLASS), true);
    moveMarkerForward();
    renderEngineV3Line();
    assert.equal(readLine().style.getPropertyValue("--axis-px"), "100");
    assert.equal(bubbleA.classList.contains(HIDES_LINE_CLASS), false);
    assert.equal(bubbleB.classList.contains(HIDES_LINE_CLASS), false);
    clearFileBubbles(container);
});

test("test_a_hidden_line_hides_inside_no_bubble", () => {
    // Steps: a bubble marked by hand, no current step so the line is hidden, draw, expect the mark gone.
    initLayer1Dom();
    storeEngineV3Steps([]);
    const container = getRequiredElementById("fileBubbleContainer");
    const bubble = appendBubbleWithNode(container, 250, 50);
    bubble.classList.add(HIDES_LINE_CLASS);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(readLine().hidden, true);
    assert.equal(bubble.classList.contains(HIDES_LINE_CLASS), false);
    clearFileBubbles(container);
});

test("test_an_edit_step_rings_the_bubble_nodes_on_the_line", () => {
    // Steps: edit step at axis px 300, bubble A node drawn at 300 (n-edit), bubble B node at 500, draw, expect only A's node ringed.
    initLayer1Dom();
    storeEngineV3Steps([buildStepOfKind("2026-06-01T10:00:00.000Z", EngineV3StepKind.edit)]);
    const container = getRequiredElementById("fileBubbleContainer");
    const bubbleA = appendBubbleWithNode(container, 250, 50);
    const bubbleB = appendBubbleWithNode(container, 0, 500);
    const nodeA = bubbleA.querySelector(".node")!;
    const nodeB = bubbleB.querySelector(".node")!;
    nodeA.classList.add("n-edit");
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(nodeA.classList.contains(CURRENT_NODE_CLASS), true);
    assert.equal(nodeB.classList.contains(CURRENT_NODE_CLASS), false);
    clearFileBubbles(container);
});

test("test_a_non_commit_step_does_not_ring_a_commit_node_on_the_line", () => {
    // Steps: edit step at axis px 300, bubble A node drawn at 300 is a commit node, draw, expect no ring on it.
    initLayer1Dom();
    storeEngineV3Steps([buildStepOfKind("2026-06-01T10:00:00.000Z", EngineV3StepKind.edit)]);
    const container = getRequiredElementById("fileBubbleContainer");
    const bubbleA = appendBubbleWithNode(container, 250, 50);
    const nodeA = bubbleA.querySelector(".node")!;
    nodeA.classList.add("n-commit");
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(nodeA.classList.contains(CURRENT_NODE_CLASS), false);
    clearFileBubbles(container);
});

test("test_a_commit_step_adds_no_ring_from_the_line", () => {
    // Steps: commit step at axis px 300, bubble A node drawn at 300 is an edit node, draw, expect no ring from the line.
    initLayer1Dom();
    storeEngineV3Steps([buildStepOfKind("2026-06-01T10:00:00.000Z", EngineV3StepKind.commit)]);
    const container = getRequiredElementById("fileBubbleContainer");
    const bubbleA = appendBubbleWithNode(container, 250, 50);
    const nodeA = bubbleA.querySelector(".node")!;
    nodeA.classList.add("n-edit");
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(nodeA.classList.contains(CURRENT_NODE_CLASS), false);
    clearFileBubbles(container);
});

test("test_the_line_color_differs_from_the_clicked_ruler_line_color", () => {
    // Steps: read the color variable of the line and of .leader.shown, expect different names and different palette values.
    const lineVariable = readLineColorVariable(readCssFile("engine-v3/engine-v3.css"), ".engine-v3-line {", "border-block-start");
    const rulerVariable = readLineColorVariable(readCssFile("bubbles/leaders.css"), ".leader.shown, .leader.aimed", "border-top-color");
    const palette = readCssFile("base/base.css").split("@media")[0]!;
    const readValue = (name: string): string => new RegExp(`${name}: (#[0-9a-f]+)`).exec(palette)![1]!;
    assert.notEqual(lineVariable, rulerVariable);
    assert.notEqual(readValue(lineVariable), readValue(rulerVariable));
});

const EDGE_VARIABLE = "--engine-line-left";

function stubElementRect(element: Element, left: number, right: number): void {
    element.getBoundingClientRect = () => ({ left, right, top: 0, bottom: 800, width: right - left, height: 800 }) as DOMRect;
}

test("test_the_left_edge_is_the_ruler_container_right_edge_without_a_commit_column", () => {
    // Scenario: Commit mode is off, no scroll, zoom 1.
    assert.equal(computeEngineV3LineLeftEdgePx(152, undefined, 0, 1), 152);
});

test("test_the_left_edge_is_the_commit_column_right_edge_when_it_is_further_right", () => {
    assert.equal(computeEngineV3LineLeftEdgePx(152, 330, 0, 1), 330);
});

test("test_the_left_edge_grows_by_the_sideways_scroll", () => {
    // Scenario: the pane scrolled 300 px; the sticky container stays at the viewport edge and the canvas left edge is -300.
    assert.equal(computeEngineV3LineLeftEdgePx(152, 330, -300, 1), 630);
});

test("test_the_left_edge_is_divided_by_the_page_zoom", () => {
    // Scenario: zoom 2 doubles every viewport rectangle value.
    assert.equal(computeEngineV3LineLeftEdgePx(304, 660, 0, 2), 330);
});

test("test_placing_the_edge_reads_the_rectangles_and_sets_the_line_variable", () => {
    // Scenario: line drawn, container right 152, commit column right 330, canvas scrolled 300 px (left -300).
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    const commitColumn = document.createElement("div");
    commitColumn.id = "jfredCommitsDrawerComponent";
    getRequiredElementById("timelineRulerContainer").append(commitColumn);
    stubElementRect(getRequiredElementById("timelineRulerContainer"), 0, 152);
    stubElementRect(commitColumn, 190, 330);
    stubElementRect(readLine().parentElement!, -300, 5000);
    placeEngineV3LineLeftEdge();
    // Expect: (330 - (-300)) / 1 = 630 px.
    assert.equal(readLine().style.getPropertyValue(EDGE_VARIABLE), "630px");
});

test("test_the_edge_follows_a_scroll_event_of_the_pane", () => {
    // Scenario: edge placed at scroll 0, then the pane scrolls 200 px and fires scroll.
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    stubElementRect(getRequiredElementById("timelineRulerContainer"), 0, 152);
    stubElementRect(readLine().parentElement!, 0, 5000);
    placeEngineV3LineLeftEdge();
    assert.equal(readLine().style.getPropertyValue(EDGE_VARIABLE), "152px");
    stubElementRect(readLine().parentElement!, -200, 5000);
    getRequiredElementById("timelineContainer").dispatchEvent(new window.Event("scroll"));
    // Expect: 352 px, with no other call.
    assert.equal(readLine().style.getPropertyValue(EDGE_VARIABLE), "352px");
});

test("test_placing_the_edge_on_a_page_without_a_line_makes_no_line", () => {
    // Scenario: refreshJfredStrip and the observers can run before the first stage render.
    initLayer1Dom();
    placeEngineV3LineLeftEdge();
    assert.equal(document.getElementById("engine-v3-line"), null);
});

test("test_one_observer_watches_the_ruler_container_and_moves_the_edge_on_resize", () => {
    // Scenario: a recording observer class is installed before the first render; the line renders twice; the kept callback is the browser reporting a resize.
    initLayer1Dom();
    const observedTargets: unknown[] = [];
    const keptCallbacks: Array<() => void> = [];
    class RecordingResizeObserver {
        constructor(callback: () => void) {
            keptCallbacks.push(callback);
        }
        observe(target: unknown): void {
            observedTargets.push(target);
        }
        unobserve(_target: unknown): void {}
        disconnect(): void {}
    }
    Object.assign(window, { ResizeObserver: RecordingResizeObserver });
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    renderEngineV3LineAtTicks(TICKS);
    assert.equal(observedTargets.length, 1);
    assert.equal(observedTargets[0], getRequiredElementById("timelineRulerContainer"));
    stubElementRect(getRequiredElementById("timelineRulerContainer"), 0, 240);
    stubElementRect(readLine().parentElement!, 0, 5000);
    keptCallbacks[0]!();
    // Expect: (240 - 0) / 1 = 240 px.
    assert.equal(readLine().style.getPropertyValue(EDGE_VARIABLE), "240px");
});

test("test_the_edge_follows_a_zoom_change_at_a_sideways_scroll", () => {
    // Scenario: the pane scrolled 200 px (canvas left -200); zoom 2 fires no resize and no scroll event, so applyZoom must place the edge.
    initLayer1Dom();
    storeEngineV3Steps([buildStep("2026-06-01T10:00:00.000Z")]);
    renderEngineV3LineAtTicks(TICKS);
    stubElementRect(getRequiredElementById("timelineRulerContainer"), 0, 152);
    stubElementRect(readLine().parentElement!, -200, 5000);
    applyZoom(2);
    // Expect: (152 - (-200)) / 2 = 176 px.
    assert.equal(readLine().style.getPropertyValue(EDGE_VARIABLE), "176px");
    applyZoom(1);
});

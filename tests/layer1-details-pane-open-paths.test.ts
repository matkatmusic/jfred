// Every way the app opens the details pane gives it the same first width: 35 percent of the visible bubble width.

import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { clearFileBubbles } from "../webapp/layer1-components/bubbles/layer1-file-bubbles-clear.ts";
import { storeDetailsPaneSharePercent } from "../webapp/layer1-components/details-drawer/layer1-details-pane.ts";
import { DiffPaneMode } from "../webapp/layer1-components/details-drawer/layer1-diff-pane.ts";
import { buildDiffView, renderDetailView } from "../webapp/layer1-components/details-drawer/layer1-diff-view.ts";
import { installNodeDrawer } from "../webapp/layer1-components/details-drawer/layer1-drawer.ts";
import { openNodeDrawer } from "../webapp/layer1-components/details-drawer/layer1-drawer-open-node.ts";
import { installAnnotationClick } from "../webapp/layer1-components/session-column/layer1-annotation-click.ts";
import { clearReverseWalks, storeReverseWalk } from "../webapp/layer1-reverse-store.ts";
import { WireReverseKind, type WireReverseState } from "../webapp/layer1-wire-reverse.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { buildScriptRunStage, storeScriptRunView } from "./layer1-drawer-script-helpers.ts";
import { DISK_FILE_CONTENT, DISK_FILE_PATH, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

const EXPECTED_WIDTH = "350px";
const REVERSE_PATH = "src/util.ts";
const REVERSE_STATES: WireReverseState[] = [
    { index: 0, kind: WireReverseKind.DiskNow, content: "now text" },
    { index: 1, kind: WireReverseKind.EditUndone, instant: "2026-07-01T12:00:00.000Z", content: "before edit text" },
];

function stubLayoutBox(element: HTMLElement, box: { left: number; right: number; top: number; bottom: number; clientWidth?: number; clientHeight?: number }): void {
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({
        left: box.left, right: box.right, top: box.top, bottom: box.bottom, width, height, x: box.left, y: box.top, toJSON() { return {}; },
    }) });
    if (box.clientWidth !== undefined) {
        Object.defineProperty(element, "clientWidth", { configurable: true, value: box.clientWidth });
    }
    if (box.clientHeight !== undefined) {
        Object.defineProperty(element, "clientHeight", { configurable: true, value: box.clientHeight });
    }
}

function stubPageLayout(): void {
    stubLayoutBox(getRequiredElementById("timelineContainer"), { left: 0, right: 1200, top: 50, bottom: 650, clientWidth: 1200, clientHeight: 600 });
    stubLayoutBox(getRequiredElementById("timelineRulerComponent"), { left: 0, right: 200, top: 50, bottom: 650 });
}

function assertPaneOpenedAtThirtyFivePercent(): void {
    const pane = getRequiredElementById("detailsPaneContainer");
    assert.ok(pane.classList.contains("open"));
    assert.equal(pane.style.width, EXPECTED_WIDTH);
}

beforeEach(() => {
    storeDetailsPaneSharePercent(35);
});

test("test_a_node_click_opens_the_pane_at_35_percent", async () => {
    // Steps: build a page with one disk node; stub the layout; open the node drawer; the pane is open at 350px.
    initLayer1Dom();
    stubPageLayout();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const node = createElement("i", { class: "node n-disk" });
    const container = getRequiredElementById("fileBubbleContainer");
    clearFileBubbles(container);
    container.append(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", "data-path": DISK_FILE_PATH }),
        createElement("div", { class: "lane" }, [node]),
    ]));
    await openNodeDrawer(node, DISK_FILE_PATH);
    assertPaneOpenedAtThirtyFivePercent();
});

test("test_a_session_dot_click_opens_the_pane_at_35_percent", async () => {
    // Steps: build a page with one session dot; stub the layout; click the dot; the pane is open at 350px.
    initLayer1Dom();
    stubPageLayout();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ type: "user", note: "dot json line" }));
    const dot = createElement("i", { class: "anode a-user", "data-session-file": "/fixture/demo/projects/0f3c9a7e.jsonl",
        "data-line": "1007", "data-session-title": "seed the demo app", "data-record-label": "fix the trim bug" });
    const container = getRequiredElementById("fileBubbleContainer");
    clearFileBubbles(container);
    container.append(dot);
    installAnnotationClick();
    dot.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    assertPaneOpenedAtThirtyFivePercent();
});

test("test_a_diff_view_opens_the_pane_at_35_percent", () => {
    // Steps: build an empty diff view; stub the layout; render it into the detail pane; the pane is open at 350px.
    initLayer1Dom();
    stubPageLayout();
    const view = buildDiffView("src/gone.ts", [], { revisionControlsShown: false, mode: DiffPaneMode.side, fullContents: false, baseIndex: 0, targetIndex: 0 });
    renderDetailView([view]);
    assertPaneOpenedAtThirtyFivePercent();
});

test("test_a_script_run_opens_the_pane_at_35_percent", async () => {
    // Steps: build a stage with a script-run node; stub the layout; click the node; the pane is open at 350px.
    initLayer1Dom();
    stubPageLayout();
    installAnimationFrameStub();
    installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
    const { nodeA } = buildScriptRunStage();
    storeScriptRunView();
    installNodeDrawer();
    nodeA.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    assertPaneOpenedAtThirtyFivePercent();
});

test("test_a_reverse_state_opens_the_pane_at_35_percent", async () => {
    // Steps: store a reverse walk and one reverse node; stub the layout; click the node; the pane is open at 350px.
    initLayer1Dom();
    stubPageLayout();
    installAnimationFrameStub();
    clearReverseWalks();
    storeReverseWalk({ path: REVERSE_PATH, states: REVERSE_STATES });
    installNodeDrawer();
    installRecordingFetch(() => ({}));
    const node = createElement("i", { class: "node n-rev", "data-index": "1", "data-kind": REVERSE_STATES[1]!.kind });
    const container = getRequiredElementById("fileBubbleContainer");
    clearFileBubbles(container);
    container.append(createElement("div", { class: "filebox" }, [
        createElement("div", { class: "fname", text: "util.ts", "data-path": REVERSE_PATH }),
        createElement("div", { class: "lane" }, [node]),
    ]));
    node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForPendingFetches();
    assertPaneOpenedAtThirtyFivePercent();
});

// The details pane lives INSIDE #fileBubbleContainer, so every redraw or clear of the bubbles must keep that same open pane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { installStreamRoute } from "./webapp-fetch-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb the first import against a throwaway DOM.
initLayer1Dom();
const { renderLayer1Stage } = await import("../webapp/layer1-components/bubbles/layer1-stage-render.ts");
const { buildNodeLinkUrl, copyOpenedNodeLink, storeOpenedNode } = await import("../webapp/layer1-components/bubbles/layer1-node-link.ts");
const { installNodeDrawer } = await import("../webapp/layer1-components/details-drawer/layer1-drawer.ts");
const { wireBubbleFlash } = await import("../webapp/layer1-components/jsonls-nav/layer1-session-flash.ts");
const { loadLayer1View, initLayer1Page } = await import("../webapp/layer1-page.ts");

const T0 = "2026-07-01T10:00:00.000Z";
const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";
const OPENED_NODE = { instant: T0, sessionFile: "/w/proj/session-a.jsonl", line: 12 };

// `count` one-commit pairs on a one-entry ruler; more than 100 forces the chunked render path.
function buildViewWithPairs(count: number): object {
    return {
        pairs: Array.from({ length: count }, (_, index) => ({
            path: `src/file${index}.ts`,
            commits: [{ hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", instant: T0, axisPx: 0 }],
            onDisk: { instant: T0, axisPx: 22 },
        })),
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ instant: T0, axisPx: 0, eventCount: count }],
    };
}

function getDetailsPane(): HTMLElement {
    return getRequiredElementById("detailsPaneContainer");
}

function openDetailsPane(): HTMLElement {
    const pane = getDetailsPane();
    pane.classList.add("open");
    return pane;
}

function assertPaneIsKeptOpenInsideBubbleContainer(pane: HTMLElement): void {
    assert.equal(getDetailsPane(), pane);
    assert.equal(pane.parentElement!.id, "fileBubbleContainer");
    assert.ok(pane.classList.contains("open"));
}

function stubClipboard(): string[] {
    const copied: string[] = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void copied.push(text) },
    });
    return copied;
}

function countMatching(selector: string): number {
    return document.querySelectorAll(selector).length;
}

test("test_the_details_pane_is_a_child_of_the_file_bubble_container", () => {
    // Scenario: the page layout puts the details pane inside the bubble area.
    // Steps:
    // build the page.
    initLayer1Dom();
    // the pane's parent is the bubble container.
    assert.equal(getDetailsPane().parentElement!.id, "fileBubbleContainer");
});

test("test_a_stage_redraw_keeps_the_open_details_pane_not_chunked", async () => {
    // Scenario: redrawing a small view keeps the same open pane inside the bubble container.
    // Steps:
    // build the page and open the pane.
    initLayer1Dom();
    const pane = openDetailsPane();
    // redraw a small view that fits one chunk.
    await renderLayer1Stage(buildViewWithPairs(3) as never);
    // the bubbles are drawn and the same pane is still open inside the container.
    assert.equal(countMatching("#fileBubbleContainer .filebox"), 3);
    assertPaneIsKeptOpenInsideBubbleContainer(pane);
});

test("test_a_stage_redraw_keeps_the_open_details_pane_chunked", async () => {
    // Scenario: redrawing a view with more widgets than one chunk keeps the same open pane, at the first chunk and at the end.
    // Steps:
    // build the page and open the pane.
    initLayer1Dom();
    const pane = openDetailsPane();
    // start a redraw of 150 widgets: the first chunk is drawn before the first wait.
    const pending = renderLayer1Stage(buildViewWithPairs(150) as never);
    // the same pane is still open inside the container between chunks.
    assertPaneIsKeptOpenInsideBubbleContainer(pane);
    // finish the redraw.
    await pending;
    // all bubbles are drawn and the same pane is still open inside the container.
    assert.equal(countMatching("#fileBubbleContainer .filebox"), 150);
    assertPaneIsKeptOpenInsideBubbleContainer(pane);
});

test("test_clearing_the_view_before_a_load_keeps_the_details_pane", async () => {
    // Scenario: loading the view again clears the bubbles first; the same open pane survives the clear.
    // Steps:
    // boot the page with a stubbed stream that holds two bubbles.
    initLayer1Dom(BOTH_ROOTS_SEARCH);
    installStreamRoute("/api/layer1-view", [buildViewWithPairs(2)]);
    await initLayer1Page();
    await waitForAsyncWork();
    assert.equal(countMatching("#fileBubbleContainer .filebox"), 2);
    // open the pane.
    const pane = openDetailsPane();
    // load the view again.
    await loadLayer1View();
    await waitForAsyncWork();
    // the bubbles are drawn again and the same pane is still open inside the container.
    assert.equal(countMatching("#fileBubbleContainer .filebox"), 2);
    assertPaneIsKeptOpenInsideBubbleContainer(pane);
});

test("test_clicking_inside_the_pane_opens_nothing_and_flashes_nothing", async () => {
    // Scenario: the pane sits inside the bubble container, so a click in it must not reach the bubble click handlers.
    // Steps:
    // build the page, draw one bubble and wire the bubble click handlers.
    initLayer1Dom();
    await renderLayer1Stage(buildViewWithPairs(1) as never);
    installNodeDrawer();
    wireBubbleFlash();
    // open the pane with a known opened node.
    openDetailsPane();
    storeOpenedNode(OPENED_NODE);
    // click inside the pane body.
    getRequiredElementById("dbody").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitForAsyncWork();
    // the opened node is still the known one.
    const copied = stubClipboard();
    await copyOpenedNodeLink();
    assert.deepEqual(copied, [buildNodeLinkUrl(location.href, OPENED_NODE)]);
    // nothing in the page gained the selection ring or a session flash.
    assert.equal(countMatching(".found, .flash, .flash-lead"), 0);
});

test("test_bubble_queries_do_not_find_nodes_inside_the_pane", async () => {
    // Scenario: a node-like element inside the pane is not counted as a bubble part.
    // Steps:
    // build the page and draw one bubble.
    initLayer1Dom();
    await renderLayer1Stage(buildViewWithPairs(1) as never);
    // count the bubble names and bubble nodes.
    const nameCountBefore = countMatching("#fileBubbleContainer .filebox .fname");
    const nodeCountBefore = countMatching("#fileBubbleContainer .filebox .node");
    assert.equal(nameCountBefore, 1);
    // add a node element inside the pane body.
    const strayNode = document.createElement("div");
    strayNode.classList.add("node");
    getRequiredElementById("dbody").appendChild(strayNode);
    // the counts are unchanged.
    assert.equal(countMatching("#fileBubbleContainer .filebox .fname"), nameCountBefore);
    assert.equal(countMatching("#fileBubbleContainer .filebox .node"), nodeCountBefore);
});

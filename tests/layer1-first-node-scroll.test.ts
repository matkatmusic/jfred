// The first render lands on a node when the first screen shows none; happy-dom has no layout, so rects and visibility are stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { scrollToFirstVisibleNode } from "../webapp/layer1-first-node-scroll.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const PANE_RECT = { top: 0, bottom: 1000, left: 0, right: 1600 };

type StubbedNode = { top: number; isVisible: boolean };

// Builds the pane and its nodes, and returns the ids of the nodes scrollIntoView was called on.
function buildStubbedStage(nodes: StubbedNode[]): number[] {
    initLayer1Dom();
    const scrolled: number[] = [];
    getRequiredElementById("timelines").getBoundingClientRect = () => PANE_RECT as DOMRect;
    const stage = getRequiredElementById("stage");
    stage.replaceChildren(...nodes.map((stub, index) => {
        const node = createElement("i", { class: "node" });
        node.getBoundingClientRect = () => ({ top: stub.top, bottom: stub.top + 15, left: 100, right: 115 }) as DOMRect;
        node.checkVisibility = () => stub.isVisible;
        node.scrollIntoView = () => { scrolled.push(index); };
        return node;
    }));
    return scrolled;
}

test("scrolls to the topmost visible node when none is on screen", () => {
    const scrolled = buildStubbedStage([{ top: 5000, isVisible: true }, { top: 3000, isVisible: true }, { top: 9000, isVisible: true }]);
    scrollToFirstVisibleNode();
    assert.deepEqual(scrolled, [1]);
});

test("does not scroll when a visible node is already on screen", () => {
    const scrolled = buildStubbedStage([{ top: 5000, isVisible: true }, { top: 400, isVisible: true }]);
    scrollToFirstVisibleNode();
    assert.deepEqual(scrolled, []);
});

test("skips hidden nodes, even a hidden one that sits on screen or higher than the rest", () => {
    const scrolled = buildStubbedStage([{ top: 400, isVisible: false }, { top: 1200, isVisible: false }, { top: 5000, isVisible: true }, { top: 7000, isVisible: true }]);
    scrollToFirstVisibleNode();
    assert.deepEqual(scrolled, [2]);
});

test("does nothing when no node is visible at all", () => {
    const scrolled = buildStubbedStage([{ top: 5000, isVisible: false }]);
    scrollToFirstVisibleNode();
    assert.deepEqual(scrolled, []);
});

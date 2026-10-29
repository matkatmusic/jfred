// Slack: a pane gains empty space on a side only when a node cannot otherwise be centred.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { addSlackForEdgeNode } from "../webapp/layer1-find-slack.ts";

initLayer1Dom();

const AREA = { left: 0, right: 500, top: 0, bottom: 800 };

function buildPane(): HTMLElement {
  const pane = document.createElement("div");
  Object.defineProperty(pane, "scrollWidth", { get: () => 5000 });
  Object.defineProperty(pane, "scrollHeight", { get: () => 9000 });
  Object.defineProperty(pane, "clientWidth", { get: () => 500 });
  Object.defineProperty(pane, "clientHeight", { get: () => 800 });
  return pane;
}

function readSlack(pane: HTMLElement, side: string): string {
  return pane.style.getPropertyValue(`--slack-${side}`);
}

test("test_a_node_near_the_top_left_adds_left_and_top_slack", () => {
  initLayer1Dom();
  const pane = buildPane();
  const box = { left: 10, right: 30, top: 20, bottom: 40 } as DOMRect;
  assert.equal(addSlackForEdgeNode(pane, box, AREA), true);
  assert.equal(readSlack(pane, "left"), "230px");
  assert.equal(readSlack(pane, "top"), "370px");
  assert.equal(readSlack(pane, "right"), "");
  assert.equal(readSlack(pane, "bottom"), "");
});

test("test_a_node_with_room_on_every_side_adds_no_slack", () => {
  initLayer1Dom();
  const pane = buildPane();
  pane.scrollLeft = 1000;
  pane.scrollTop = 1000;
  const box = { left: 250, right: 250, top: 400, bottom: 400 } as DOMRect;
  assert.equal(addSlackForEdgeNode(pane, box, AREA), false);
  assert.equal(readSlack(pane, "left"), "");
});

test("test_repeat_calls_add_to_the_existing_slack", () => {
  initLayer1Dom();
  const pane = buildPane();
  const box = { left: 10, right: 30, top: 200, bottom: 220 } as DOMRect;
  addSlackForEdgeNode(pane, box, AREA);
  addSlackForEdgeNode(pane, box, AREA);
  assert.equal(readSlack(pane, "left"), "460px");
});

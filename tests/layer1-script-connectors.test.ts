// Task 356: one connector per script run with dots in 2+ bubbles, positioned from layout offsets (happy-dom has no layout, so the offsets are stubbed).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "../webapp/app-dom.ts";
import { drawScriptConnectors } from "../webapp/layer1-script-connectors.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function stubLayout(element: HTMLElement, offsetParent: HTMLElement | null, offsetLeft: number, offsetTop: number): void {
  Object.defineProperties(element, {
    offsetParent: { value: offsetParent, configurable: true },
    offsetLeft: { value: offsetLeft, configurable: true },
    offsetTop: { value: offsetTop, configurable: true },
  });
}

// One bubble: filebox at (boxLeft, boxTop) in the stage, lane at (6, 50) in the box, dot at (0, dotTop) in the lane.
function buildBubble(stage: HTMLElement, toolUseId: string, boxLeft: number, boxTop: number, dotTop: number): HTMLElement {
  const dot = createElement("i", { class: "node n-script", "data-tool-use-id": toolUseId });
  const lane = createElement("div", { class: "lane" }, [dot]);
  const box = createElement("div", { class: "filebox" }, [lane]);
  stage.append(box);
  stubLayout(box, stage, boxLeft, boxTop);
  stubLayout(lane, box, 6, 50);
  stubLayout(dot, lane, 0, dotTop);
  return dot;
}

function buildStage(): HTMLElement {
  initLayer1Dom();
  const stage = document.getElementById("stage")!;
  stage.replaceChildren();
  return stage;
}

test("test_a_run_with_dots_in_two_bubbles_gets_one_connector_from_the_left_dot_to_the_right_dot_at_the_dot_height", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  buildBubble(stage, "toolu_a", 310, 100, 40);
  drawScriptConnectors(stage);
  const connectors = [...stage.querySelectorAll<HTMLElement>(".script-connector")];
  assert.equal(connectors.length, 1);
  assert.equal(connectors[0]!.dataset["toolUseId"], "toolu_a");
  assert.equal(connectors[0]!.style.left, "16px");
  assert.equal(connectors[0]!.style.width, "300px");
  assert.equal(connectors[0]!.style.top, "190px");
});

test("test_a_run_with_one_dot_gets_no_connector", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  drawScriptConnectors(stage);
  assert.equal(stage.querySelectorAll(".script-connector").length, 0);
});

test("test_each_run_gets_its_own_connector", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  buildBubble(stage, "toolu_b", 160, 100, 90);
  buildBubble(stage, "toolu_a", 310, 100, 40);
  buildBubble(stage, "toolu_b", 460, 100, 90);
  drawScriptConnectors(stage);
  const ids = [...stage.querySelectorAll<HTMLElement>(".script-connector")].map((connector) => connector.dataset["toolUseId"]);
  assert.deepEqual(ids, ["toolu_a", "toolu_b"]);
});

test("test_a_dot_outside_a_positioned_stage_throws", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  const second = buildBubble(stage, "toolu_a", 310, 100, 40);
  stubLayout(second.parentElement!.parentElement!, null, 310, 100);
  assert.throws(() => drawScriptConnectors(stage), /positioned stage/);
});

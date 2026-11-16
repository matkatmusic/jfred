// Task 356: one connector per script run with dots in 2+ bubbles; offsets are stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "../webapp/app-dom.ts";
import { renderScriptConnectors } from "../webapp/layer1-components/bubbles/layer1-script-connectors.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function stubLayout(element: HTMLElement, offsetParent: HTMLElement | null, offsetLeft: number, offsetTop: number): void {
  Object.defineProperties(element, {
    offsetParent: { value: offsetParent, configurable: true },
    offsetLeft: { value: offsetLeft, configurable: true },
    offsetTop: { value: offsetTop, configurable: true },
  });
}

// One bubble: filebox in the stage, lane at (6, 50) in the box, dot in the lane.
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
  const stage = document.getElementById("fileBubbleContainer")!;
  stage.replaceChildren();
  return stage;
}

test("test_a_run_with_dots_in_two_bubbles_gets_one_connector_from_the_left_dot_to_the_right_dot_at_the_dot_height", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  buildBubble(stage, "toolu_a", 310, 100, 40);
  renderScriptConnectors(stage);
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
  renderScriptConnectors(stage);
  assert.equal(stage.querySelectorAll(".script-connector").length, 0);
});

test("test_each_run_gets_its_own_connector", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  buildBubble(stage, "toolu_b", 160, 100, 90);
  buildBubble(stage, "toolu_a", 310, 100, 40);
  buildBubble(stage, "toolu_b", 460, 100, 90);
  renderScriptConnectors(stage);
  const ids = [...stage.querySelectorAll<HTMLElement>(".script-connector")].map((connector) => connector.dataset["toolUseId"]);
  assert.deepEqual(ids, ["toolu_a", "toolu_b"]);
});

test("test_a_dot_outside_a_positioned_stage_throws", () => {
  const stage = buildStage();
  buildBubble(stage, "toolu_a", 10, 100, 40);
  const second = buildBubble(stage, "toolu_a", 310, 100, 40);
  stubLayout(second.parentElement!.parentElement!, null, 310, 100);
  assert.throws(() => renderScriptConnectors(stage), /positioned stage/);
});

// RED before the orphan row draws its dots: "Expected values to be strictly equal: 1 !== 2".
test("test_the_connector_finder_sees_dots_on_orphan_rows", async () => {
  // Scenario: a run with a dot in a pair bubble and a dot on a disk-only row in the orphan bucket gets one connector.
  // Steps:
  // an empty stage holds a pair bubble with one dot of the run.
  const stage = buildStage();
  const { buildOrphanBucket } = await import("../webapp/layer1-widgets.ts");
  buildBubble(stage, "toolu_fixture_orphan_1", 10, 100, 40);
  // an orphan bucket holds one disk orphan whose scriptRuns has the same run.
  const orphanRun = {
    instant: "2026-06-02T09:00:00.000Z",
    axisPx: 30,
    toolUseId: "toolu_fixture_orphan_1",
    executorKind: "python" as const,
    language: "python" as const,
    code: "print('fixture')",
    sessionId: "session_fixture_1",
    sessionFile: "session_fixture_1.jsonl",
  };
  const bucket = buildOrphanBucket("Disk only", [{ path: "scratch/disk_only_example.py", instant: "2026-06-02T09:00:00.000Z", axisPx: 30, scriptRuns: [orphanRun] }])!;
  stage.append(bucket);
  // the stage holds two dots: the pair dot and the orphan dot.
  assert.equal(stage.querySelectorAll("i.n-script").length, 2);
  // the orphan dot gets a layout chain: dot, holder, li, ul, bucket, stage.
  const orphanDot = bucket.querySelector<HTMLElement>("i.n-script")!;
  const holder = orphanDot.parentElement!;
  const row = holder.parentElement!;
  const rowList = row.parentElement!;
  stubLayout(bucket, stage, 310, 100);
  stubLayout(rowList, bucket, 4, 60);
  stubLayout(row, rowList, 0, 20);
  stubLayout(holder, row, 90, 2);
  stubLayout(orphanDot, holder, 0, 5);
  // the connector finder draws exactly one connector for the run.
  renderScriptConnectors(stage);
  assert.equal(stage.querySelectorAll(".script-connector").length, 1);
});

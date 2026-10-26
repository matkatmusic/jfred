// Task 257.5/323: openNodeDrawer anchors the clicked node; openNeighbour steps along its lane.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getRequiredElementById } from "../webapp/app-dom.ts";
import { clearAnchor, openNeighbour, openNodeDrawer, readAnchor } from "../webapp/layer1-drawer-open-node.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { DISK_FILE_CONTENT, DISK_FILE_PATH, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

function buildTwoNodeLane(): { firstNode: HTMLElement; secondNode: HTMLElement } {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  clearAnchor();
  const firstNode = createElement("i", { class: "node n-disk" });
  const secondNode = createElement("i", { class: "node n-disk" });
  getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
    createElement("div", { class: "fname", "data-path": DISK_FILE_PATH }),
    createElement("div", { class: "lane" }, [firstNode, secondNode]),
  ]));
  return { firstNode, secondNode };
}

test("opening a node anchors it, opens the drawer and disables the arrow with no neighbour", async () => {
  const { firstNode } = buildTwoNodeLane();
  await openNodeDrawer(firstNode, DISK_FILE_PATH);
  assert.equal(readAnchor()?.node, firstNode);
  assert.ok(getRequiredElementById("drawer").classList.contains("open"));
  assert.equal((getRequiredElementById("dprev") as HTMLButtonElement).disabled, true);
  assert.equal((getRequiredElementById("dnext") as HTMLButtonElement).disabled, false);
});

test("openNeighbour moves the anchor to the next node in the lane", async () => {
  const { firstNode, secondNode } = buildTwoNodeLane();
  await openNodeDrawer(firstNode, DISK_FILE_PATH);
  openNeighbour(1);
  await waitForPendingFetches();
  assert.equal(readAnchor()?.node, secondNode);
});

test("clearAnchor forgets the anchor and openNeighbour then does nothing", () => {
  const { firstNode } = buildTwoNodeLane();
  void openNodeDrawer(firstNode, DISK_FILE_PATH);
  clearAnchor();
  openNeighbour(1);
  assert.equal(readAnchor(), undefined);
});

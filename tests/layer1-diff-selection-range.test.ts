// Task 329: applyDiffSelectionRange turns two nodes into a global range wash over their files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { rememberDrawnView, rememberNavTargets } from "../webapp/layer1-diff-wash.ts";
import { applyDiffSelectionRange } from "../webapp/layer1-diff-selection-range.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import {
  DISK_FILE_CONTENT, DISK_FILE_PATH, LANE_T0, LANE_T2, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches,
} from "./layer1-drawer-test-helpers.ts";

function buildTwoNodeStage(): { firstNode: HTMLElement; otherNode: HTMLElement } {
  const firstNode = createElement("i", { class: "node n-disk" });
  const otherNode = createElement("i", { class: "node n-disk" });
  getRequiredElementById("stage").replaceChildren(
    createElement("div", { class: "filebox" }, [createElement("div", { class: "fname", "data-path": DISK_FILE_PATH }), createElement("div", { class: "lane" }, [firstNode])]),
    createElement("div", { class: "filebox" }, [createElement("div", { class: "fname", "data-path": "src/other.ts" }), createElement("div", { class: "lane" }, [otherNode])]),
  );
  rememberDrawnView({
    pairs: [
      { path: DISK_FILE_PATH, commits: [], onDisk: { instant: LANE_T0, axisPx: 10 } },
      { path: "src/other.ts", commits: [], onDisk: { instant: LANE_T2, axisPx: 40 } },
    ],
    gitOrphans: [], diskOrphans: [],
    ruler: [{ instant: LANE_T0, axisPx: 10, eventCount: 1 }, { instant: LANE_T2, axisPx: 40, eventCount: 1 }],
  } as WireLayer1View);
  rememberNavTargets([]);
  return { firstNode, otherNode };
}

test("selecting the same node twice changes nothing", () => {
  initLayer1Dom();
  const { firstNode } = buildTwoNodeStage();
  applyDiffSelectionRange({ node: firstNode, path: DISK_FILE_PATH }, firstNode, DISK_FILE_PATH);
  assert.equal(getRequiredElementById("dpath").textContent, "");
  assert.equal(firstNode.classList.contains("diff-base"), false);
});

test("two nodes become base (earlier) and target (later) over both files", async () => {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  getInputById("dir").value = "/project";
  const { firstNode, otherNode } = buildTwoNodeStage();
  applyDiffSelectionRange({ node: otherNode, path: "src/other.ts" }, firstNode, DISK_FILE_PATH);
  await waitForPendingFetches();
  assert.ok(firstNode.classList.contains("diff-base"));
  assert.ok(otherNode.classList.contains("diff-target"));
  assert.equal(getRequiredElementById("dpath").textContent, "2 files — range diff");
  assert.equal(getRequiredElementById("dbody").querySelectorAll("details.dfile").length, 2);
});

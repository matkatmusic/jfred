// A branch lane node (.bnode) opens the same drawer as a trunk edit node, reading its sides from the branch revision route.

import { test } from "node:test";
import assert from "node:assert/strict";
import { el, getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { getFirstPane, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

const CHANGE_ID = "toolu_lane_node";

function answerBranchFile(params: URLSearchParams): object {
  return { content: params.get("side") === "base" ? "old lane line" : "new lane line" };
}

function drawLaneNode(): { dot: HTMLElement; label: HTMLElement } {
  const identity = { "data-change-id": CHANGE_ID, "data-kind": "edit", "data-instant": "2026-06-02T09:35:00.000Z" };
  const dot = el("i", { class: "bnode", ...identity });
  const label = el("span", { class: "blabel", text: "edit", ...identity });
  getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
    el("div", { class: "fname", text: "util.ts", "data-path": "src/util.ts" }),
    el("div", { class: "lane" }, [el("div", { class: "blane" }, [dot, label])]),
  ]));
  wireNodeDrawer();
  return { dot, label };
}

async function openLaneNode(pickTarget: (nodes: { dot: HTMLElement; label: HTMLElement }) => HTMLElement): Promise<{ url: string }[]> {
  setupLayer1Dom();
  installAnimationFrameStub();
  getInputById("dir").value = "/work";
  const asks = installRecordingFetch(answerBranchFile);
  pickTarget(drawLaneNode()).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();
  return asks;
}

function listBranchAsks(asks: { url: string }[]): URLSearchParams[] {
  return asks.filter((ask) => ask.url.includes("editChangeId"))
    .map((ask) => new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1)));
}

test("clicking a lane dot opens the drawer and reads both sides of that change id from the branch route", async () => {
  const asks = await openLaneNode((nodes) => nodes.dot);
  const params = listBranchAsks(asks);
  assert.deepEqual([...new Set(params.map((entry) => entry.get("side")))].sort(), ["base", "target"]);
  assert.ok(params.every((entry) => entry.get("editChangeId") === CHANGE_ID && entry.get("branch") === "1"
    && entry.get("path") === "src/util.ts" && entry.get("dir") === "/work"));
  assert.ok(getRequiredElementById("drawer").classList.contains("open"));
  assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "before - after");
});

test("clicking a lane label opens the same drawer, named for the file and the revision kind", async () => {
  const asks = await openLaneNode((nodes) => nodes.label);
  assert.ok(listBranchAsks(asks).every((entry) => entry.get("branch") === "1"));
  assert.equal(getRequiredElementById("dpath").textContent, "util.ts Edit");
  assert.equal(getRequiredElementById("dmeta").textContent, "branch revision · edit");
});

test("a trunk edit node's reads carry no branch flag", async () => {
  setupLayer1Dom();
  installAnimationFrameStub();
  getInputById("dir").value = "/work";
  const asks = installRecordingFetch(answerBranchFile);
  const identity = { "data-change-id": CHANGE_ID, "data-kind": "edit", "data-confidence": "verified", "data-session-file": "/s/a.jsonl" };
  const node = el("i", { class: "node n-edit", ...identity });
  getRequiredElementById("stage").replaceChildren(el("div", { class: "filebox" }, [
    el("div", { class: "fname", text: "util.ts", "data-path": "src/util.ts" }),
    el("div", { class: "lane" }, [node]),
  ]));
  wireNodeDrawer();
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();
  assert.ok(listBranchAsks(asks).length > 0);
  assert.ok(listBranchAsks(asks).every((entry) => entry.get("branch") === null));
});

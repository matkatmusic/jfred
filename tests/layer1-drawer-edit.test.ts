// Edit/Write nodes open replayed base and target, Reads open beacon bytes; both flash the session and show raw JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-drawer.ts";
import { writeSourcePaths } from "../webapp/layer1-source-paths.ts";
import { SourceKind } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { getFirstPane, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

const SESSION_FILE = "/fixture/demo/projects/b21d84c5.jsonl";
const CHANGE_ID = "toolu_fixture_004";
const RECORD = { type: "assistant", toolUseResult: { structuredPatch: [{ oldStart: 3 }] }, note: "raw record text" };

function answerEditFile(params: URLSearchParams): object {
  if (params.has("line")) {
    return RECORD;
  }
  return { content: params.get("side") === "base" ? "old line" : "new line", title: "Second title" };
}

function drawEditNode(kind: string, kindClass: string): HTMLElement {
  const identity = { "data-change-id": CHANGE_ID, "data-kind": kind, "data-confidence": "verified",
    "data-session-id": "fixture-b21d84c5", "data-session-file": SESSION_FILE, "data-line": "58" };
  const node = createElement("i", { class: `node ${kindClass} conf-verified`, ...identity });
  getRequiredElementById("stage").replaceChildren(createElement("div", { class: "filebox" }, [
    createElement("div", { class: "fname", text: "util.ts", "data-path": "src/util.ts" }),
    createElement("div", { class: "lane" }, [node, createElement("span", { class: `nlabel ${kindClass}`, text: "[e]" })]),
  ]));
  getRequiredElementById("sessions").replaceChildren(createElement("div", { class: "session-item", "data-file": "b21d84c5.jsonl" }));
  installNodeDrawer();
  return node;
}

async function clickNode(node: HTMLElement): Promise<void> {
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();
}

function setUpPage(): { url: string; body?: string }[] {
  initLayer1Dom();
  installAnimationFrameStub();
  getInputById("dir").value = "/work";
  return installRecordingFetch(answerEditFile);
}

function listFileAsks(asks: { url: string }[]): URLSearchParams[] {
  return asks.filter((ask) => ask.url.includes("editChangeId"))
    .map((ask) => new URLSearchParams(ask.url.slice(ask.url.indexOf("?") + 1)));
}

test("clicking an edit node reads the base and the target side by change id", async () => {
  const asks = setUpPage();
  await clickNode(drawEditNode("edit", "n-edit"));
  const params = listFileAsks(asks);
  assert.deepEqual([...new Set(params.map((entry) => entry.get("side")))].sort(), ["base", "target"]);
  assert.ok(params.every((entry) => entry.get("editChangeId") === CHANGE_ID && entry.get("path") === "src/util.ts"
    && entry.get("dir") === "/work"));
  assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "before - after");
});

test("an edit node's drawer names the kind, the confidence and the owning session", async () => {
  setUpPage();
  await clickNode(drawEditNode("edit", "n-edit"));
  assert.equal(getRequiredElementById("dpath").textContent, "util.ts Edit - Second title");
  assert.equal(getRequiredElementById("dmeta").textContent, "verified · edit of b21d84c5.jsonl");
  assert.ok(getRequiredElementById("sessions").querySelector(".flash-lead"));
});

test("an edit node reveals a [{ }] button that toggles its raw transcript JSON", async () => {
  setUpPage();
  await clickNode(drawEditNode("write", "n-edit"));
  assert.equal(getRequiredElementById("dpath").textContent, "util.ts Write - Second title");
  const toggle = getRequiredElementById("dbody").querySelector(".json-toggle") as HTMLButtonElement;
  const jsonBox = getRequiredElementById("dbody").querySelector(".node-json") as HTMLElement;
  assert.equal(jsonBox.hidden, true);
  toggle.click();
  await waitForPendingFetches();
  assert.equal(jsonBox.hidden, false);
  assert.ok(jsonBox.textContent?.includes("structuredPatch"));
  assert.ok(jsonBox.textContent?.includes("raw record text"));
});

test("test_edit_step_params_carry_jsonl_folders", async () => {
  const asks = setUpPage();
  writeSourcePaths(SourceKind.jsonl, ["/logs/a", "/logs/b"]);
  await clickNode(drawEditNode("edit", "n-edit"));
  const params = listFileAsks(asks);
  assert.ok(params.length > 0);
  assert.ok(params.every((entry) => entry.getAll("jsonl").join(",") === "/logs/a,/logs/b" && entry.get("editChangeId") === CHANGE_ID
    && entry.get("path") === "src/util.ts" && entry.get("dir") === "/work" && entry.has("side")));
  writeSourcePaths(SourceKind.jsonl, []);
});

test("a Read beacon shows one revision: the bytes as read", async () => {
  const asks = setUpPage();
  await clickNode(drawEditNode("read", "n-read"));
  assert.ok(listFileAsks(asks).every((entry) => entry.get("side") === "target"));
  assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "as read");
  assert.equal(getRequiredElementById("dpath").textContent, "util.ts Read - Second title");
  assert.equal(getRequiredElementById("dmeta").textContent, "verified · read of b21d84c5.jsonl");
});

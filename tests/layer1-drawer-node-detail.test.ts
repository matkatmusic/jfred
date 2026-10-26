// Task 257.5/317/213: the single-node drawer's header, meta row, fetch params and raw JSON reveal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { appendRawJsonReveal, getNodeDrawerDetail } from "../webapp/layer1-drawer-node-detail.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("a node with no commit hash reads the working tree", () => {
  initLayer1Dom();
  getInputById("dir").value = "/work";
  const detail = getNodeDrawerDetail(createElement("i", { class: "node" }), "src/a.ts");
  assert.equal(detail.head, "a.ts — Current on-disk state");
  assert.equal(detail.meta, "working tree");
  assert.equal(detail.params.get("path"), "src/a.ts");
  assert.equal(detail.params.get("dir"), "/work");
});

test("a snapshot node reads its owning session's file-history and names the file to flash", () => {
  initLayer1Dom();
  const node = createElement("i", { class: "node n-snap", "data-session-file": "/x/s1.jsonl", "data-session-id": "s1", "data-version": "3" });
  const detail = getNodeDrawerDetail(node, "src/a.ts");
  assert.equal(detail.head, "a.ts Snapshot");
  assert.equal(detail.meta, "file-history @v3 of s1.jsonl");
  assert.equal(detail.flashFile, "s1.jsonl");
  assert.equal(detail.params.get("version"), "3");
});

test("appendRawJsonReveal adds a hidden JSON box that its toggle shows", () => {
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal({ type: "user" });
  const box = getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json");
  assert.equal(box?.hidden, true);
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")?.click();
  assert.equal(box?.hidden, false);
});

// Task 257.5/317/213: the single-node drawer's header, meta row, fetch params and raw JSON reveal.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createElement,getInputById, getRequiredElementById } from "../webapp/app-dom.ts";
import { appendRawJsonReveal, getNodeDrawerDetail } from "../webapp/layer1-components/details-drawer/layer1-drawer-node-detail.ts";
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

test("test_the_raw_json_button_reads_braces_without_square_brackets", () => {
  // Steps: add the reveal, then read the toggle text.
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal({ type: "user" });
  assert.equal(getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")?.textContent, "{ }");
});

// The page loads these sheets under .viz-root; the test DOM cannot lay out text, so computed styles are the honest check.
function loadDrawerFrameStyles(): void {
  const style = document.createElement("style");
  const frameCss = readFileSync(new URL("../webapp/layer1-components/details-drawer/drawer-frame.css", import.meta.url), "utf8");
  style.textContent = frameCss;
  document.head.append(style);
}

function renderRawJsonBox(record: unknown): HTMLElement {
  initLayer1Dom();
  loadDrawerFrameStyles();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal(record);
  return getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json")!;
}

// The color a plain element gets from an inline style, so the expected value is normalized the same way.
function computeColorOfHex(hex: string): string {
  const probe = document.createElement("span");
  probe.style.color = hex;
  document.body.append(probe);
  return window.getComputedStyle(probe).color;
}

function computeTokenColor(box: HTMLElement, selector: string): string {
  return window.getComputedStyle(box.querySelector(selector)!).color;
}

const RAW_JSON_RECORD = { name: "text", count: 3, flag: true };

test("the raw JSON key shows in the light key color", () => {
  // Steps: reveal a record, then compare its key color to the light key color #1f5fbf.
  const box = renderRawJsonBox(RAW_JSON_RECORD);
  assert.equal(computeTokenColor(box, ".json-key"), computeColorOfHex("#1f5fbf"));
});

test("the raw JSON string value shows in the light string color", () => {
  // Steps: reveal a record, then compare its string color to the light string color #0a7a3e.
  const box = renderRawJsonBox(RAW_JSON_RECORD);
  assert.equal(computeTokenColor(box, ".json-string"), computeColorOfHex("#0a7a3e"));
});

test("the raw JSON number shows in the light number color", () => {
  // Steps: reveal a record, then compare its number color to the light number color #b25000.
  const box = renderRawJsonBox(RAW_JSON_RECORD);
  assert.equal(computeTokenColor(box, ".json-number"), computeColorOfHex("#b25000"));
});

test("the raw JSON boolean shows in the light atom color", () => {
  // Steps: reveal a record, then compare its boolean color to the light atom color #8a3fb0.
  const box = renderRawJsonBox(RAW_JSON_RECORD);
  assert.equal(computeTokenColor(box, ".json-bool"), computeColorOfHex("#8a3fb0"));
});

test("the raw JSON punctuation shows in the light plain color", () => {
  // Steps: reveal a record, then compare the text color of the pre to the light plain color #52514e.
  const box = renderRawJsonBox(RAW_JSON_RECORD);
  assert.equal(window.getComputedStyle(box.querySelector("pre")!).color, computeColorOfHex("#52514e"));
});

test("the raw JSON text wraps, even inside one long token with no spaces", () => {
  // Steps: reveal a record holding a 2000-character unbroken string, then read the wrap styling of the shown element.
  const box = renderRawJsonBox({ text: "x".repeat(2000) });
  const shown = window.getComputedStyle(box.querySelector("pre")!);
  assert.equal(shown.whiteSpace, "pre-wrap");
  assert.equal(shown.overflowWrap, "anywhere");
});

test("the raw JSON box does not scroll sideways", () => {
  // Steps: reveal a record, then read the overflow of the shown element.
  const box = renderRawJsonBox({ text: "x".repeat(2000) });
  assert.equal(window.getComputedStyle(box.querySelector("pre")!).overflowX, "hidden");
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

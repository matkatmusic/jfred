// The raw JSON reveal: a long string collapses to 10 lines, and its […] button shows only when the wrapped text needs it.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { appendRawJsonReveal, appendRawJsonRevealForLine } from "../webapp/layer1-components/details-drawer/layer1-drawer-node-detail.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const LONG_TEXT_RECORD = { text: "x".repeat(2000) };
const CLAMPED_HEIGHT = 180;
const FITS_HEIGHT = 150;
const OVERFLOWS_HEIGHT = 400;

// The test DOM cannot lay out text, so the test states the heights a browser would report.
function defineElementHeights(element: Element, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
}

function revealLongStringWithHeights(scrollHeight: number): HTMLElement {
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal(LONG_TEXT_RECORD);
  const box = getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json")!;
  defineElementHeights(box.querySelector(".json-collapsed")!, scrollHeight, CLAMPED_HEIGHT);
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  return box;
}

test("a string that wraps to fewer than 10 lines shows no expand button", () => {
  // Steps: reveal a long string whose full height fits the 10-line clamp, then read the button.
  const box = revealLongStringWithHeights(FITS_HEIGHT);
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, true);
});

test("a string that wraps to 10 lines or more shows the expand button", () => {
  // Steps: reveal a long string taller than the 10-line clamp, then read the button.
  const box = revealLongStringWithHeights(OVERFLOWS_HEIGHT);
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, false);
});

test("a click on the expand button shows the full string", () => {
  // Steps: reveal a long string, click the button, then look for the collapsed string.
  const box = revealLongStringWithHeights(OVERFLOWS_HEIGHT);
  box.querySelector<HTMLElement>(".json-expand")!.click();
  assert.equal(box.querySelector(".json-collapsed"), null);
});

test("a second click on the expand button collapses the string again", () => {
  // Steps: reveal a long string, click the button twice, then look for the collapsed string.
  const box = revealLongStringWithHeights(OVERFLOWS_HEIGHT);
  box.querySelector<HTMLElement>(".json-expand")!.click();
  box.querySelector<HTMLElement>(".json-expand")!.click();
  assert.notEqual(box.querySelector(".json-collapsed"), null);
});

test("a hidden expand button takes no space in the drawer", () => {
  // Steps: load the drawer styles, reveal a long string that fits, then read the button's display.
  initLayer1Dom();
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../webapp/layer1-components/details-drawer/drawer-frame.css", import.meta.url), "utf8");
  document.head.append(style);
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal(LONG_TEXT_RECORD);
  const box = getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json")!;
  defineElementHeights(box.querySelector(".json-collapsed")!, FITS_HEIGHT, CLAMPED_HEIGHT);
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  assert.equal(window.getComputedStyle(box.querySelector(".json-expand")!).display, "none");
});

// The fetched box fills after the click, so the heights go on the element class before the fetch resolves.
async function revealFetchedLongStringWithHeights(scrollHeight: number): Promise<HTMLElement> {
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  defineElementHeights(window.HTMLElement.prototype, scrollHeight, CLAMPED_HEIGHT);
  globalThis.fetch = async () => new Response(JSON.stringify(LONG_TEXT_RECORD));
  appendRawJsonRevealForLine("/x/s1.jsonl", 3);
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json")!;
}

test("a fetched string that wraps to fewer than 10 lines shows no expand button", async () => {
  // Steps: click the { } toggle, wait for the fetched JSON, then read the button.
  const box = await revealFetchedLongStringWithHeights(FITS_HEIGHT);
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, true);
});

test("a fetched string that wraps to 10 lines or more shows the expand button", async () => {
  // Steps: click the { } toggle, wait for the fetched JSON, then read the button.
  const box = await revealFetchedLongStringWithHeights(OVERFLOWS_HEIGHT);
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, false);
});

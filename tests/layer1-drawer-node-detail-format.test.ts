// The raw JSON reveal: a long string with line breaks gets a format button that swaps the raw token for real code lines.

import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { renderHighlightedJson } from "../webapp/inspector-json.ts";
import { appendRawJsonReveal, appendRawJsonRevealForLine } from "../webapp/layer1-components/details-drawer/layer1-drawer-node-detail.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const CODE_WITH_LINE_BREAKS = Array.from({ length: 40 }, (_, index) => "const value" + index + " = " + index + ";").join("\n");
const OTHER_CODE_WITH_LINE_BREAKS = Array.from({ length: 40 }, (_, index) => "let other" + index + " = " + index + ";").join("\n");
const LONG_TEXT_WITHOUT_LINE_BREAKS = "x".repeat(2000);
const SHORT_TEXT_WITH_LINE_BREAKS = "first line\nsecond line";
const CLAMPED_HEIGHT = 180;
const FITS_HEIGHT = 150;
const OVERFLOWS_HEIGHT = 400;
const FORMAT_BUTTON_SELECTOR = '[data-component="detailsPaneRawJsonFormatButton"]';

// The test DOM cannot lay out text, so the test states the heights a browser would report.
function defineElementHeights(element: Element, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
}

function revealRecordWithHeights(record: object, scrollHeight: number): HTMLElement {
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal(record);
  const box = getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json")!;
  defineElementHeights(box.querySelector(".json-collapsed")!, scrollHeight, CLAMPED_HEIGHT);
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  return box;
}

function revealCodeWithHeights(scrollHeight: number): HTMLElement {
  return revealRecordWithHeights({ code: CODE_WITH_LINE_BREAKS }, scrollHeight);
}

function loadDrawerStyles(): void {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../webapp/layer1-components/details-drawer/drawer-frame.css", import.meta.url), "utf8");
  document.head.append(style);
}

test("a long string with line breaks shows a format button", () => {
  // Steps: reveal a long string that holds line breaks, then look for the format button.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  assert.notEqual(box.querySelector(FORMAT_BUTTON_SELECTOR), null);
});

test("the format button reads format before any click", () => {
  // Steps: reveal a long string that holds line breaks, then read the button text.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  assert.equal(box.querySelector(FORMAT_BUTTON_SELECTOR)!.textContent, "format");
});

test("the code block is hidden before any click", () => {
  // Steps: reveal a long string that holds line breaks, then read the code block.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  assert.equal(box.querySelector<HTMLElement>(".json-code")!.hidden, true);
});

test("a click on the format button hides the raw string", () => {
  // Steps: reveal a long string, click the format button, then read the raw string.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  const rawString = box.querySelector<HTMLElement>(".json-collapsed")!;
  box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!.click();
  assert.equal(rawString.hidden, true);
});

test("a click on the format button shows the code block", () => {
  // Steps: reveal a long string, click the format button, then read the code block.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!.click();
  assert.equal(box.querySelector<HTMLElement>(".json-code")!.hidden, false);
});

test("the code block holds the real string with real line breaks", () => {
  // Steps: reveal a long string, click the format button, then read the code block text.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!.click();
  assert.equal(box.querySelector<HTMLElement>(".json-code")!.textContent, CODE_WITH_LINE_BREAKS);
});

test("a click on the format button hides the expand button", () => {
  // Steps: reveal a long string whose expand button shows, click the format button, then read the expand button.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!.click();
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, true);
});

test("a click on the format button changes its text to raw", () => {
  // Steps: reveal a long string, click the format button, then read the button text.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  const formatButton = box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!;
  formatButton.click();
  assert.equal(formatButton.textContent, "raw");
});

test("a second click on the format button shows the raw string again", () => {
  // Steps: reveal a long string, click the format button twice, then read the raw string.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  const rawString = box.querySelector<HTMLElement>(".json-collapsed")!;
  const formatButton = box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!;
  formatButton.click();
  formatButton.click();
  assert.equal(rawString.hidden, false);
});

test("a second click on the format button hides the code block again", () => {
  // Steps: reveal a long string, click the format button twice, then read the code block.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  const formatButton = box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!;
  formatButton.click();
  formatButton.click();
  assert.equal(box.querySelector<HTMLElement>(".json-code")!.hidden, true);
});

test("a second click on the format button brings the expand button back", () => {
  // Steps: reveal a long string whose expand button shows, click the format button twice, then read the expand button.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  const formatButton = box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!;
  formatButton.click();
  formatButton.click();
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, false);
});

test("a second click on the format button keeps a hidden expand button hidden", () => {
  // Steps: reveal a long string whose expand button is hidden, click the format button twice, then read the expand button.
  const box = revealCodeWithHeights(FITS_HEIGHT);
  const formatButton = box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!;
  formatButton.click();
  formatButton.click();
  assert.equal(box.querySelector<HTMLElement>(".json-expand")!.hidden, true);
});

test("a second click on the format button changes its text back to format", () => {
  // Steps: reveal a long string, click the format button twice, then read the button text.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  const formatButton = box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!;
  formatButton.click();
  formatButton.click();
  assert.equal(formatButton.textContent, "format");
});

test("formatting one string leaves a second long string raw", () => {
  // Steps: reveal two long code strings, click the first format button, then read the second raw string.
  const box = revealRecordWithHeights({ first: CODE_WITH_LINE_BREAKS, second: OTHER_CODE_WITH_LINE_BREAKS }, OVERFLOWS_HEIGHT);
  box.querySelectorAll<HTMLElement>(FORMAT_BUTTON_SELECTOR)[0]!.click();
  assert.equal(box.querySelectorAll<HTMLElement>(".json-collapsed")[1]!.hidden, false);
});

test("formatting one string leaves the code block of a second long string hidden", () => {
  // Steps: reveal two long code strings, click the first format button, then read the second code block.
  const box = revealRecordWithHeights({ first: CODE_WITH_LINE_BREAKS, second: OTHER_CODE_WITH_LINE_BREAKS }, OVERFLOWS_HEIGHT);
  box.querySelectorAll<HTMLElement>(FORMAT_BUTTON_SELECTOR)[0]!.click();
  assert.equal(box.querySelectorAll<HTMLElement>(".json-code")[1]!.hidden, true);
});

test("a long string without line breaks shows no format button", () => {
  // Steps: reveal a long string with no line breaks, then look for the format button.
  const box = revealRecordWithHeights({ text: LONG_TEXT_WITHOUT_LINE_BREAKS }, OVERFLOWS_HEIGHT);
  assert.equal(box.querySelector(FORMAT_BUTTON_SELECTOR), null);
});

test("a short string with line breaks shows no expand button", () => {
  // Steps: reveal a string of 560 characters or less that holds a line break, then look for the expand button.
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal({ text: SHORT_TEXT_WITH_LINE_BREAKS });
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  assert.equal(getRequiredElementById("dbody").querySelector(".json-expand"), null);
});

test("a short string with line breaks shows no format button", () => {
  // Steps: reveal a string of 560 characters or less that holds a line break, then look for the format button.
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  appendRawJsonReveal({ text: SHORT_TEXT_WITH_LINE_BREAKS });
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  assert.equal(getRequiredElementById("dbody").querySelector(FORMAT_BUTTON_SELECTOR), null);
});

test("the old page highlighted JSON shows no format button", () => {
  // Steps: render highlighted JSON for a long string with line breaks, then look for the format button.
  initLayer1Dom();
  const record = { message: { content: CODE_WITH_LINE_BREAKS } };
  const emptyMaps = { uuidToLine: new Map<string, number>(), toolIdToLines: new Map<string, number[]>() };
  const pre = renderHighlightedJson(JSON.stringify(record, null, 4), record, 1, emptyMaps, () => {}, [], () => {});
  assert.equal(pre.querySelector(".json-format"), null);
});

test("a formatted string hides its raw token in the drawer styles", () => {
  // Steps: reveal a long string, load the drawer styles, click the format button, then read the raw string's display.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  loadDrawerStyles();
  const rawString = box.querySelector<HTMLElement>(".json-collapsed")!;
  box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!.click();
  assert.equal(window.getComputedStyle(rawString).display, "none");
});

test("an unformatted code block takes no space in the drawer styles", () => {
  // Steps: reveal a long string, load the drawer styles, then read the code block's display.
  const box = revealCodeWithHeights(OVERFLOWS_HEIGHT);
  loadDrawerStyles();
  assert.equal(window.getComputedStyle(box.querySelector(".json-code")!).display, "none");
});

// The fetched box fills after the click, so the heights go on the element class before the fetch resolves.
async function revealFetchedCodeWithHeights(scrollHeight: number): Promise<HTMLElement> {
  initLayer1Dom();
  getRequiredElementById("dbody").replaceChildren();
  defineElementHeights(window.HTMLElement.prototype, scrollHeight, CLAMPED_HEIGHT);
  globalThis.fetch = async () => new Response(JSON.stringify({ code: CODE_WITH_LINE_BREAKS }));
  appendRawJsonRevealForLine("/x/s1.jsonl", 3);
  getRequiredElementById("dbody").querySelector<HTMLElement>(".json-toggle")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return getRequiredElementById("dbody").querySelector<HTMLElement>(".node-json")!;
}

test("a fetched long string with line breaks shows a format button", async () => {
  // Steps: click the { } toggle, wait for the fetched JSON, then look for the format button.
  const box = await revealFetchedCodeWithHeights(OVERFLOWS_HEIGHT);
  assert.notEqual(box.querySelector(FORMAT_BUTTON_SELECTOR), null);
});

test("a click on a fetched format button shows the real string in the code block", async () => {
  // Steps: click the { } toggle, wait for the fetched JSON, click the format button, then read the code block text.
  const box = await revealFetchedCodeWithHeights(OVERFLOWS_HEIGHT);
  box.querySelector<HTMLElement>(FORMAT_BUTTON_SELECTOR)!.click();
  assert.equal(box.querySelector<HTMLElement>(".json-code")!.textContent, CODE_WITH_LINE_BREAKS);
});

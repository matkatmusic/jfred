// Details-pane find widget: typing counts matches, Enter steps, reset clears.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { initDetailsFind, resetDetailsFind } from "../webapp/views/details-find.ts";

class FakeHighlight {
  constructor(..._ranges: unknown[]) {}
}

function openFindPane(bodyText: string): HTMLInputElement {
  initWebappDom();
  const browserWindow = (globalThis as unknown as { window: Record<string, unknown> }).window;
  Object.assign(globalThis, { Range: browserWindow.Range, NodeFilter: browserWindow.NodeFilter, Highlight: FakeHighlight });
  document.getElementById("details-right-body")!.textContent = bodyText;
  initDetailsFind();
  return document.getElementById("details-find-input") as HTMLInputElement;
}

function readCounterText(): string | null {
  return document.getElementById("details-find-count")!.textContent;
}

function typeTerm(input: HTMLInputElement, term: string): void {
  input.value = term;
  input.oninput!(new Event("input"));
}

test("typing a term shows the counter and reveals the clear button", () => {
  const input = openFindPane("foo bar foo");
  typeTerm(input, "foo");
  assert.equal(readCounterText(), "1/2");
  assert.equal((document.getElementById("details-find-clear") as HTMLButtonElement).hidden, false);
});

test("the next button wraps to the first match", () => {
  const input = openFindPane("foo bar foo");
  typeTerm(input, "foo");
  const nextButton = document.getElementById("details-find-next")!;
  nextButton.click();
  assert.equal(readCounterText(), "2/2");
  nextButton.click();
  assert.equal(readCounterText(), "1/2");
});

test("resetDetailsFind zeroes the counter", () => {
  const input = openFindPane("foo");
  typeTerm(input, "foo");
  resetDetailsFind();
  assert.equal(readCounterText(), "0/0");
});

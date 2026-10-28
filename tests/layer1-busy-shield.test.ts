// Task 355 step 7b: the blocking overlay shown while the Edit payload loads.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachBusyShield, closeBusyShield, openBusyShield, renderBusyShield, renderBusyShieldError } from "../webapp/layer1-busy-shield.ts";
import { loadEditsOnce } from "../webapp/layer1-edits.ts";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";

function readById(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function checkHidden(id: string): boolean {
  return readById(id).hasAttribute("hidden");
}

test("test_open_shows_shield_with_label_and_zero_fill", () => {
  initLayer1Dom();
  openBusyShield("starting");
  assert.equal(checkHidden("busy-shield"), false);
  assert.equal(readById("busy-label").textContent, "starting");
  assert.equal(Number.parseFloat(readById("busy-fill").style.width), 0);
  assert.equal(checkHidden("busy-cancel"), false);
  assert.equal(checkHidden("busy-error"), true);
  assert.equal(checkHidden("busy-close"), true);
});

test("test_paint_counts_up_label_and_fill_width", () => {
  initLayer1Dom();
  openBusyShield("starting");
  renderBusyShield("reading Edit/Write events", 3, 10);
  assert.ok(readById("busy-label").textContent!.includes("3 / 10"));
  assert.equal(readById("busy-fill").style.width, "30%");
});

test("test_shield_covers_viewport_and_hides_with_hidden_attribute", () => {
  initLayer1Dom();
  const css = readFileSync(new URL("../webapp/layer1-styles.css", import.meta.url), "utf8");
  assert.match(css, /\.busy-shield \{[^}]*position: fixed;[^}]*inset: 0;/);
  assert.match(css, /\.busy-shield\[hidden\] \{ display: none; \}/);
  assert.equal(checkHidden("busy-shield"), true);
});

test("test_error_keeps_shield_open_with_message_and_close_button", () => {
  initLayer1Dom();
  openBusyShield("starting");
  renderBusyShieldError("Error: boom");
  assert.equal(checkHidden("busy-shield"), false);
  assert.equal(readById("busy-error").textContent, "Error: boom");
  assert.equal(checkHidden("busy-error"), false);
  assert.equal(checkHidden("busy-close"), false);
  assert.equal(checkHidden("busy-cancel"), true);
});

test("test_close_hides_shield_and_clears_error_and_fill", () => {
  initLayer1Dom();
  openBusyShield("starting");
  renderBusyShield("reading", 5, 10);
  renderBusyShieldError("Error: boom");
  closeBusyShield();
  assert.equal(checkHidden("busy-shield"), true);
  assert.equal(readById("busy-error").textContent, "");
  assert.equal(Number.parseFloat(readById("busy-fill").style.width), 0);
});

test("test_close_button_closes_the_shield", () => {
  initLayer1Dom();
  attachBusyShield();
  openBusyShield("starting");
  renderBusyShieldError("Error: boom");
  readById("busy-close").click();
  assert.equal(checkHidden("busy-shield"), true);
});

test("test_cancel_button_aborts_the_load", async () => {
  initLayer1Dom();
  attachBusyShield();
  Object.assign(globalThis, { fetch: (_url: unknown, options?: RequestInit) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }) });
  const view = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
  const loading = loadEditsOnce(view);
  assert.equal(checkHidden("busy-shield"), false);
  readById("busy-cancel").click();
  assert.equal(await loading, false);
  await waitForAsyncWork();
  assert.equal(checkHidden("busy-shield"), true);
});

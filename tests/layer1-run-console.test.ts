// L6 mockup: the run console popup is static, built once on first open, and never makes a request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunConsolePopup, buildRunConsoleTrigger, openRunConsole } from "../webapp/layer1-run-console.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

function findRunConsole(): HTMLElement {
  return document.getElementById("run-console") as HTMLElement;
}

test("buildRunConsolePopup holds one pre, one streaming caption and the three cancel buttons", () => {
  initLayer1Dom();
  const popup = buildRunConsolePopup();
  assert.equal(popup.id, "run-console");
  assert.equal(popup.hidden, true);
  assert.equal(popup.querySelectorAll("pre.console-pre").length, 1);
  assert.match(popup.querySelector(".console-output .console-caption")!.textContent, /not an animation/);
  assert.equal(popup.querySelectorAll(".console-caption").length, 1);
  assert.equal(popup.querySelectorAll(".state-caption").length, 1);
  const buttons = [...popup.querySelectorAll<HTMLButtonElement>("button.cancel-btn")];
  assert.deepEqual(buttons.map((button) => button.className), [
    "cancel-btn btn-idle",
    "cancel-btn btn-live",
    "cancel-btn btn-cancelled",
  ]);
  assert.deepEqual(buttons.map((button) => button.disabled), [true, false, true]);
  assert.deepEqual(
    [...popup.querySelectorAll(".state-label")].map((label) => label.textContent),
    ["idle", "running-cancelable", "cancelled"],
  );
});

test("buildRunConsolePopup holds the four terminal blocks in order", () => {
  initLayer1Dom();
  const popup = buildRunConsolePopup();
  const blocks = [...popup.querySelectorAll(".terminal-block")];
  assert.deepEqual(
    blocks.map((block) => block.className),
    [
      "terminal-block term-cancelled",
      "terminal-block term-verified",
      "terminal-block term-mismatch",
      "terminal-block term-original-failed",
    ],
  );
  assert.equal(blocks[3]!.querySelector(".terminal-title")!.textContent, "Original run failed");
});

test("openRunConsole twice leaves one visible popup inside #stagewrap", () => {
  initLayer1Dom();
  assert.equal(findRunConsole(), null);
  openRunConsole();
  openRunConsole();
  assert.equal(document.querySelectorAll("#run-console").length, 1);
  assert.equal(findRunConsole().hidden, false);
  assert.equal(findRunConsole().parentElement!.id, "stagewrap");
});

test("the Close button hides the popup and the trigger opens it again", () => {
  initLayer1Dom();
  openRunConsole();
  const closeButton = findRunConsole().querySelector<HTMLButtonElement>("button.run-console-close")!;
  assert.equal(closeButton.textContent, "Close");
  closeButton.click();
  assert.equal(findRunConsole().hidden, true);
  const trigger = buildRunConsoleTrigger();
  const openButton = trigger.querySelector<HTMLButtonElement>("button.run-console-open")!;
  assert.equal(openButton.textContent, "Open run console");
  openButton.click();
  assert.equal(document.querySelectorAll("#run-console").length, 1);
  assert.equal(findRunConsole().hidden, false);
});

test("opening, cancelling and closing never call fetch", () => {
  initLayer1Dom();
  const fetchCalls: unknown[] = [];
  Object.assign(globalThis, {
    fetch: (...args: unknown[]) => {
      fetchCalls.push(args);
      throw new Error("the run console must not fetch");
    },
  });
  openRunConsole();
  findRunConsole().querySelector<HTMLButtonElement>("button.btn-live")!.click();
  findRunConsole().querySelector<HTMLButtonElement>("button.run-console-close")!.click();
  assert.equal(fetchCalls.length, 0);
});

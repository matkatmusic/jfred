// DOM tests for webapp/app-console.ts: collapse/open toggle the rightcol class and the terminal is created once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_closeProgressConsole_adds_class_and_openProgressConsole_removes_it", async () => {
  initWebappDom();
  const { closeProgressConsole, openProgressConsole } = await import("../webapp/app-console.ts");
  const rightColumn = document.getElementById("rightcol")!;
  closeProgressConsole();
  assert.equal(rightColumn.classList.contains("console-collapsed"), true);
  assert.equal(document.getElementById("console-last")!.textContent, "");
  openProgressConsole();
  assert.equal(rightColumn.classList.contains("console-collapsed"), false);
});

test("test_initProgressTerminal_creates_the_terminal_once_and_exposes_it_on_window", async () => {
  initWebappDom();
  const { initProgressTerminal, progressTerminal: before } = await import("../webapp/app-console.ts");
  assert.equal(before, null);
  initProgressTerminal();
  const { progressTerminal: created } = await import("../webapp/app-console.ts");
  assert.notEqual(created, null);
  assert.equal(window.progressTerminal, created);
  initProgressTerminal();
  const { progressTerminal: reused } = await import("../webapp/app-console.ts");
  assert.equal(reused, created);
});

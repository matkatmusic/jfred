// The script-run drawer's three native <details> folds: start state and builders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement,getRequiredElementById } from "../webapp/app-dom.ts";
import { buildScriptRunFileFold, buildScriptRunFold } from "../webapp/layer1-script-run-folds.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { openScriptRunDrawerByClick } from "./layer1-drawer-script-helpers.ts";

test("buildScriptRunFold puts the summary first and honours the open flag", () => {
  initLayer1Dom();
  const closed = buildScriptRunFold("x-fold", createElement("summary", { text: "head" }), [createElement("p", { text: "body" })], false);
  const opened = buildScriptRunFold("x-fold", createElement("summary", { text: "head" }), [createElement("p", { text: "body" })], true);
  assert.equal(closed.className, "x-fold");
  assert.equal(closed.open, false);
  assert.equal(opened.open, true);
  assert.equal(closed.firstElementChild?.tagName, "SUMMARY");
  assert.equal(closed.lastElementChild?.textContent, "body");
});

test("buildScriptRunFileFold is closed, counts the files and lists one path per line", () => {
  initLayer1Dom();
  const fold = buildScriptRunFileFold("rename.py", ["src/a.ts", "src/b.ts"]);
  assert.equal(fold.open, false);
  assert.equal(fold.querySelector("summary")?.textContent, "rename.py · 2 affected file(s)");
  assert.equal(fold.lastElementChild?.textContent, "src/a.ts\nsrc/b.ts");
});

test("a script-run drawer folds its file list closed, its meta list closed, and its script body open", async () => {
  await openScriptRunDrawerByClick();

  const fileFold = getRequiredElementById("dmeta").querySelector("details");
  assert.ok(fileFold instanceof window.HTMLDetailsElement);
  assert.equal(fileFold.open, false);
  assert.equal(fileFold.querySelector("summary")?.textContent, "rename_inv.py · 2 affected file(s)");
  assert.ok((fileFold.textContent ?? "").includes("src/a.ts\nsrc/b.ts"));
  const body = getRequiredElementById("dbody");
  const metaFold = body.querySelector("details.script-meta-fold");
  assert.ok(metaFold instanceof window.HTMLDetailsElement);
  assert.equal(metaFold.open, false);
  assert.equal(metaFold.querySelector("summary")?.textContent, "kind, executor, instant, session, line, tool use id");
  assert.ok(metaFold.querySelector("dl.script-meta"));
  const bodyFold = body.querySelector("details.scriptbody");
  assert.ok(bodyFold instanceof window.HTMLDetailsElement);
  assert.equal(bodyFold.open, true);
  assert.equal(bodyFold.querySelector("summary.sbhead b")?.textContent, "rename_inv.py");
  assert.ok(bodyFold.querySelector("pre"));
  assert.equal(body.querySelectorAll("details.dfile").length, 2);
});

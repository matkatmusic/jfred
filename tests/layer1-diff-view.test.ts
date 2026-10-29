// Task 319: THE DiffView builder: the empty-state body and the lone-section fold lock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { DiffPaneMode } from "../webapp/layer1-diff-pane.ts";
import { buildDiffView, renderDetailView } from "../webapp/layer1-diff-view.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const BASE_CONFIG = { revisionControlsShown: false, mode: DiffPaneMode.side, fullContents: false, baseIndex: 0, targetIndex: 0 };

test("a view with no steps shows the given empty text", () => {
  initLayer1Dom();
  const view = buildDiffView("src/gone.ts", [], { ...BASE_CONFIG, emptyText: "nothing here" });
  assert.equal(view.querySelector(".dbinary")?.textContent, "nothing here");
});

test("a lone section drops its name plate when rendered", () => {
  initLayer1Dom();
  const view = buildDiffView("src/gone.ts", [], BASE_CONFIG);
  renderDetailView([view]);
  assert.equal(view.querySelector(".dfile-path"), null);
  assert.equal(getRequiredElementById("dfold-all").textContent, "Collapse all");
});

test("two sections show the fold-all button when rendered", () => {
  initLayer1Dom();
  const sections = [createElement("details", { class: "dfile", open: "" }), createElement("details", { class: "dfile", open: "" })];
  renderDetailView(sections);
  assert.equal(getRequiredElementById("dmulti").hidden, false);
});

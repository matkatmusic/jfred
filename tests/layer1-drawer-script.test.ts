// Task 356: a shared script-run drawer, keyed by toolUseId rather than (node, path).

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { SCRIPT_RUN, SCRIPT_TOOL_USE_ID, buildScriptRunStage, armScriptRunView, openScriptRunDrawerByClick, openSingleRunDrawer } from "./layer1-drawer-script-helpers.ts";
import { wireNodeDrawer } from "../webapp/layer1-drawer.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { DISK_FILE_CONTENT, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

test("task 356: clicking a script-run node opens the shared drawer with the resolved body", async () => {
  await openScriptRunDrawerByClick();

  assert.ok(getRequiredElementById("drawer").classList.contains("open"));
  const header = getRequiredElementById("dpath");
  assert.equal(header.firstChild?.textContent, "rename_inv.py");
  const badges = [...header.querySelectorAll(".run-status")].map((badge) => `${badge.textContent}=${badge.getAttribute("title")}`);
  assert.deepEqual(badges, ["❌=not verified", "✅=located", "❌=not replayed"]);
  const titleText = header.textContent ?? "";
  for (const expected of ["Verified: ❌", "Located: ✅", "Replayed: ❌"]) {
    assert.ok(titleText.includes(expected), titleText);
  }
  assert.ok(!/[📍⏸🚫]/u.test(titleText), titleText);
  const metaText = getRequiredElementById("dmeta").textContent ?? "";
  assert.ok(metaText.includes("src/a.ts") && metaText.includes("src/b.ts"), metaText);
  const body = getRequiredElementById("dbody");
  assert.equal(body.querySelector(".scriptbody pre")?.textContent, SCRIPT_RUN.code);
  assert.equal(body.querySelector(".scriptbody .sbhead b")?.textContent, "rename_inv.py");
  assert.equal(body.querySelector(".scriptbody .prov")?.textContent,
    `resolved body · ${SCRIPT_RUN.sessionFile} · line 83 · ${SCRIPT_TOOL_USE_ID} · ${SCRIPT_RUN.instant}`);
  const metaRows = [...body.querySelectorAll("dl.script-meta dt")].map((term) => `${term.textContent}=${term.nextElementSibling?.textContent}`);
  assert.deepEqual(metaRows, [
    "kind=script run (layer 4)", "executor=python run", `instant=${SCRIPT_RUN.instant}`,
    `session=${SCRIPT_RUN.sessionFile}`, "line=83", `tool use id=${SCRIPT_TOOL_USE_ID}`,
  ]);
  // One diff pane per affected path (src/a.ts and src/b.ts both carry this toolUseId).
  assert.equal(getRequiredElementById("dbody").querySelectorAll("details.dfile").length, 2);
});

test("task 356: clicking the shared connector opens the SAME drawer as clicking a node", async () => {
  initLayer1Dom();
  installAnimationFrameStub();
  installRecordingFetch(() => ({ content: DISK_FILE_CONTENT }));
  const { connector } = buildScriptRunStage();
  armScriptRunView();
  wireNodeDrawer();

  connector.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();

  assert.equal(getRequiredElementById("dpath").firstChild?.textContent, "rename_inv.py");
});

test("task 356: an unlabeled script run (no static filename) still opens, with a generated header", async () => {
  await openSingleRunDrawer({ ...SCRIPT_RUN, toolUseId: "toolu_inline", label: undefined });

  assert.equal(getRequiredElementById("dpath").firstChild?.textContent, "python run");
});

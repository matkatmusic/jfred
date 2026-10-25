// After the Edit fetch ends, the loadbar names each phase until the edit nodes are drawn, then hides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom, waitForAsyncWork } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { renderLayer1View } = await import("../webapp/layer1-page.ts");
const { LAYER1_PROGRESS_LABEL_DRAWING_EDITS, LAYER1_PROGRESS_LABEL_DRAWING_RULER, LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE } =
  await import("../webapp/layer1-progress.ts");

const T0 = "2026-06-01T09:00:00.000Z";
const PAIR_COUNT = 150;
const EDIT = { instant: T0, kind: "edit", changeId: "toolu_edit_0", confidence: "verified",
  sessionId: "s0", sessionFile: "/fixture/s0.jsonl", line: 3 };

function buildChunkedView(): never {
  return {
    pairs: Array.from({ length: PAIR_COUNT }, (_, index) => ({
      path: `src/file${index}.ts`,
      commits: [{ hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: T0, axisPx: 0 }],
      onDisk: { instant: T0, axisPx: 22 },
    })),
    gitOrphans: [],
    diskOrphans: [],
    ruler: [{ instant: T0, axisPx: 0, eventCount: PAIR_COUNT }],
  } as never;
}

// One entry per DOM mutation batch and painted frame: the label, or "hidden" when the bar is put away.
function sampleLoadbarEveryStep(): string[] {
  const samples: string[] = [];
  const readBar = (): string =>
    document.getElementById("loadbar")!.hasAttribute("hidden") ? "hidden" : document.getElementById("loadbar-label")!.textContent!;
  const paintFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => {
    samples.push(readBar());
    return paintFrame(callback);
  };
  new window.MutationObserver(() => samples.push(readBar())).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  return samples;
}

test("test_the_loadbar_names_every_phase_from_the_edit_fetch_to_the_drawn_nodes", async () => {
  initLayer1Dom();
  stubStreamRoute("/api/layer1-edits", [
    { kind: "progress", label: "reading Edit/Write events", current: 1, total: 1 },
    { pairs: [{ path: "src/file0.ts", edits: [EDIT] }] },
  ]);
  await renderLayer1View(buildChunkedView());
  const samples = sampleLoadbarEveryStep();
  const box = document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!;
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  for (let turn = 0; turn < 10; turn++) {
    await waitForAsyncWork();
  }
  const editsStart = samples.findIndex((label) => label === LAYER1_PROGRESS_LABEL_DRAWING_EDITS);
  assert.notEqual(editsStart, -1);
  const afterFetch = samples.slice(editsStart);
  const firstHidden = afterFetch.indexOf("hidden");
  assert.ok(firstHidden > 0);
  assert.ok(afterFetch.slice(0, firstHidden).every((label) => label !== ""));
  assert.ok(afterFetch.slice(firstHidden).every((label) => label === "hidden"));
  assert.ok(afterFetch.some((label) => label.startsWith(`${LAYER1_PROGRESS_LABEL_DRAWING_TIMELINE} — 100 / `)));
  assert.ok(afterFetch.includes(LAYER1_PROGRESS_LABEL_DRAWING_RULER));
  assert.ok(document.querySelectorAll(".n-edit").length > 0);
});

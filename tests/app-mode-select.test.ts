// DOM tests for webapp/app-mode-select.ts: the prescan row note and the mode selection view.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

async function importModeSelectInFreshDom(): Promise<typeof import("../webapp/app-mode-select.ts")> {
  initWebappDom();
  return import("../webapp/app-mode-select.ts");
}

test("test_formatPrescanRowNote_formats_the_instant_and_marks_script_candidates", async () => {
  // Scenario: the ISO instant is spaced and suffixed UTC; a script-run candidate gets a mark.
  const { formatPrescanRowNote } = await importModeSelectInFreshDom();
  assert.equal(formatPrescanRowNote({ path: "/a", firstEventInstant: "2026-01-01T00:00:00Z", firstEventIsScriptRunCandidate: false }), "first event 2026-01-01 00:00:00 UTC");
  assert.equal(formatPrescanRowNote({ path: "/a", firstEventInstant: "2026-01-01T00:00:00Z", firstEventIsScriptRunCandidate: true }), "first event 2026-01-01 00:00:00 UTC · script-run candidate");
});

test("test_renderModeSelectionView_renders_one_row_per_prescanned_file", async () => {
  // Scenario: the view fetches /api/prescan and shows a row for each touched file.
  const { renderModeSelectionView } = await importModeSelectInFreshDom();
  const files = [
    { path: "/a.ts", firstEventInstant: "2026-01-01T00:00:00Z", firstEventIsScriptRunCandidate: false },
    { path: "/b.ts", firstEventInstant: "2026-01-02T00:00:00Z", firstEventIsScriptRunCandidate: true },
  ];
  globalThis.fetch = (async () => new Response(JSON.stringify({ files }))) as typeof fetch;
  const container = document.createElement("div");
  await renderModeSelectionView(container, "proj");
  const rowPaths = [...container.querySelectorAll(".mode-file-row code")].map((code) => code.textContent);
  assert.deepEqual(rowPaths, ["/a.ts", "/b.ts"]);
});

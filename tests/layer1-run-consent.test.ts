// Per-file test for webapp/layer1-run-consent.ts: the Docker-box text, script list, and once-per-open answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunConsentAllowed, openRunConsent, buildRunConsentScripts, buildRunConsentText, resetRunConsent } from "../webapp/layer1-components/popups/layer1-run-consent.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";

const PYTHON_RUN: WireScriptRun = {
  instant: T1, axisPx: 0, toolUseId: "toolu_py_late", executorKind: "python", language: "python",
  line: 7, code: "print('late')", sessionId: "s1", sessionFile: "/logs/s1.jsonl",
};
const EARLY_RUN: WireScriptRun = { ...PYTHON_RUN, instant: T0, toolUseId: "toolu_py_early", language: "python3", line: undefined, code: "print('early')" };
const BASH_RUN: WireScriptRun = { ...PYTHON_RUN, instant: T2, toolUseId: "toolu_bash", executorKind: "bash", language: "bash", code: "ls" };
const NODE_RUN: WireScriptRun = { ...PYTHON_RUN, instant: T2, toolUseId: "toolu_node", language: "javascript", code: "1" };

// Two bubbles share the late run, so it must be listed once.
const VIEW: WireLayer1View = {
  pairs: [
    { path: "a.ts", commits: [], onDisk: { instant: T2, axisPx: 0 }, scriptRuns: [PYTHON_RUN, BASH_RUN] },
    { path: "b.ts", commits: [], onDisk: { instant: T2, axisPx: 0 }, scriptRuns: [PYTHON_RUN, EARLY_RUN, NODE_RUN] },
    { path: "c.ts", commits: [], onDisk: { instant: T2, axisPx: 0 } },
  ],
  gitOrphans: [], diskOrphans: [], ruler: [],
};

function openFreshPage(): void {
  initLayer1Dom();
  resetRunConsent();
}

function readOverlayCount(): number {
  return document.querySelectorAll(".modal-wrap.run-consent").length;
}

function clickOverlayButton(label: string): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".run-consent button")) {
    if (button.textContent === label) {
      button.click();
    }
  }
}

test("test_buildRunConsentText_names_the_docker_box", () => {
  // Verify: the dialog tells the truth about the box.
  const text = buildRunConsentText();
  assert.ok(text.includes("copied files only"));
  assert.ok(text.includes("no network"));
  assert.ok(text.includes("Docker container"));
  assert.ok(text.includes("Docker must be on"));
  assert.ok(!text.includes("full access"));
});

test("test_buildRunConsentScripts_lists_each_python_run_once_in_time_order", () => {
  // Verify: bash and javascript runs are not listed; a run in two bubbles is one entry.
  const scripts = buildRunConsentScripts(VIEW);
  assert.deepEqual(scripts, [
    { timestamp: T0, code: "print('early')", readOnly: false },
    { timestamp: T1, code: "print('late')", readOnly: false, source: { filePath: "/logs/s1.jsonl", lineNumber: 7 } },
  ]);
});

test("test_openRunConsent_shows_one_row_per_distinct_run_and_remembers_allow", async () => {
  // Verify: Run scripts resolves true, removes the overlay, and a second ask opens nothing.
  openFreshPage();
  const pending = openRunConsent(VIEW);
  assert.equal(readOverlayCount(), 1);
  assert.equal(document.querySelectorAll(".run-consent .consent-script").length, 2);
  clickOverlayButton("Run scripts");
  assert.equal(await pending, true);
  assert.equal(readOverlayCount(), 0);
  assert.equal(await openRunConsent(VIEW), true);
  assert.equal(readOverlayCount(), 0);
});

test("test_openRunConsent_puts_the_overlay_inside_viz_root", () => {
  // Verify: the overlay sits inside .viz-root so it uses the page colours.
  openFreshPage();
  void openRunConsent(VIEW);
  assert.equal(document.querySelectorAll(".viz-root > .modal-wrap.run-consent").length, 1);
  clickOverlayButton("Run scripts");
});

test("test_openRunConsent_remembers_a_decline", async () => {
  // Verify: Continue without running resolves false and the second ask returns false with no overlay.
  openFreshPage();
  const pending = openRunConsent(VIEW);
  clickOverlayButton("Continue without running");
  assert.equal(await pending, false);
  assert.equal(await openRunConsent(VIEW), false);
  assert.equal(readOverlayCount(), 0);
});

test("test_isRunConsentAllowed_is_false_until_the_user_says_yes", async () => {
  // Verify: only an "allowed" answer gives true; start, decline and reset give false.
  openFreshPage();
  assert.equal(isRunConsentAllowed(), false);
  const declined = openRunConsent(VIEW);
  clickOverlayButton("Continue without running");
  await declined;
  assert.equal(isRunConsentAllowed(), false);
  resetRunConsent();
  const allowed = openRunConsent(VIEW);
  clickOverlayButton("Run scripts");
  await allowed;
  assert.equal(isRunConsentAllowed(), true);
  resetRunConsent();
  assert.equal(isRunConsentAllowed(), false);
});

test("test_resetRunConsent_makes_the_next_ask_open_the_dialog_again", async () => {
  // Verify: a page reload (module reset) asks again.
  openFreshPage();
  const first = openRunConsent(VIEW);
  clickOverlayButton("Run scripts");
  await first;
  resetRunConsent();
  const second = openRunConsent(VIEW);
  assert.equal(readOverlayCount(), 1);
  clickOverlayButton("Run scripts");
  await second;
});

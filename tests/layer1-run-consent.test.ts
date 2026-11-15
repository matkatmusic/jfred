// Per-file test for webapp/layer1-run-consent.ts: the Docker-box text, script list, and once-per-open answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunConsentAllowed, openRunConsent, buildRunConsentScripts, buildRunConsentText, resetRunConsent, openScriptReplayConsent, openMissingExecutablesNotice } from "../webapp/layer1-components/popups/layer1-run-consent.ts";
import type { WireScriptReplayNeeds, WireScriptReplayRunReply, WireScriptReplayTask, WireScriptReplayTaskResult } from "../webapp/layer1-wire-script-replay.ts";
import { WireScriptReplayProblem, WireScriptReplayReason } from "../webapp/layer1-wire-script-replay.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
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
  // Verify: the overlay sits inside .appWindow so it uses the page colours.
  openFreshPage();
  void openRunConsent(VIEW);
  assert.equal(document.querySelectorAll(".appWindow > .modal-wrap.run-consent").length, 1);
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

const REPLAY_NOTE_TEXT = "Replay runs saved scripts (Python and shell). Each script runs in a Docker container. The container gets copies of your project files only. It has no network. It cannot read, change, or delete your other files.";

function makeReplayTask(taskId: string, isInSpan: boolean, waitingPath: string): WireScriptReplayTask {
  return {
    taskId, instant: T1, isInSpan, code: `print('${taskId}')`, cwd: "/project", language: "python",
    waitingFiles: [{ path: waitingPath, reason: WireScriptReplayReason.namedByFile }],
  };
}

function makeReplayNeeds(tasks: WireScriptReplayTask[]): WireScriptReplayNeeds {
  return { tasks };
}

function readPopupText(): string {
  return document.querySelector(".run-consent")?.textContent ?? "";
}

function listPopupButtonLabels(): string[] {
  const labels: string[] = [];
  for (const button of document.querySelectorAll<HTMLButtonElement>(".run-consent button")) {
    labels.push(button.textContent ?? "");
  }
  return labels;
}

test("test_popup_lists_one_row_per_task", async () => {
  // Open the replay popup for two tasks.
  openFreshPage();
  const pending = openScriptReplayConsent(makeReplayNeeds([makeReplayTask("t1", true, "src/a.ts"), makeReplayTask("t2", true, "src/b.ts")]));
  // The title, the note text, and the count line show.
  assert.ok(readPopupText().includes("Replay recorded scripts?"));
  assert.ok(readPopupText().includes(REPLAY_NOTE_TEXT));
  assert.ok(readPopupText().includes("2 recorded script(s) are needed for this commit"));
  // There are two script rows, each with its waiting file path.
  assert.equal(document.querySelectorAll(".run-consent .consent-script").length, 2);
  assert.ok(readPopupText().includes("src/a.ts"));
  assert.ok(readPopupText().includes("src/b.ts"));
  clickOverlayButton("Continue without running");
  await pending;
});

test("test_run_button_resolves_true", async () => {
  // Open the popup and click Run scripts.
  openFreshPage();
  const pending = openScriptReplayConsent(makeReplayNeeds([makeReplayTask("t1", true, "src/a.ts")]));
  clickOverlayButton("Run scripts");
  // The promise resolves true and the popup is gone.
  assert.equal(await pending, true);
  assert.equal(readOverlayCount(), 0);
});

test("test_continue_without_running_resolves_false", async () => {
  // Open the popup and click Continue without running.
  openFreshPage();
  const pending = openScriptReplayConsent(makeReplayNeeds([makeReplayTask("t1", true, "src/a.ts")]));
  clickOverlayButton("Continue without running");
  // The promise resolves false and the popup is gone.
  assert.equal(await pending, false);
  assert.equal(readOverlayCount(), 0);
});

test("test_problem_shows_the_problem_text_and_only_the_continue_button", async () => {
  // Open the popup for a needs answer with a Docker problem.
  openFreshPage();
  const pending = openScriptReplayConsent({ problem: WireScriptReplayProblem.dockerNotRunning, problemText: "Docker is not running: start Docker.", tasks: [] });
  // The problem text shows.
  assert.ok(readPopupText().includes("Docker is not running: start Docker."));
  // Only the Continue without running button shows.
  assert.deepEqual(listPopupButtonLabels(), ["Continue without running"]);
  // Clicking it resolves false.
  clickOverlayButton("Continue without running");
  assert.equal(await pending, false);
});

test("test_earlier_task_is_marked", async () => {
  // Open the popup for one task inside the span and one task before it.
  openFreshPage();
  const pending = openScriptReplayConsent(makeReplayNeeds([makeReplayTask("t1", true, "src/a.ts"), makeReplayTask("t2", false, "src/b.ts")]));
  // The earlier task shows the marker text exactly once.
  const markerCount = readPopupText().split("earlier script, needed as input").length - 1;
  assert.equal(markerCount, 1);
  clickOverlayButton("Continue without running");
  await pending;
});

test("test_second_call_asks_again", async () => {
  // Ask once and click Run scripts.
  openFreshPage();
  const needs = makeReplayNeeds([makeReplayTask("t1", true, "src/a.ts")]);
  const first = openScriptReplayConsent(needs);
  clickOverlayButton("Run scripts");
  await first;
  // Ask a second time: the popup opens again and the old answer is not reused.
  const second = openScriptReplayConsent(needs);
  assert.equal(readOverlayCount(), 1);
  clickOverlayButton("Continue without running");
  assert.equal(await second, false);
});

function makeTaskResult(taskId: string, missingExecutable?: string): WireScriptReplayTaskResult {
  const result: WireScriptReplayTaskResult = { taskId, outcome: WireRunOutcome.replayFailed, timedOut: false, stdout: "", stderr: "", files: [] };
  if (missingExecutable !== undefined) {
    result.missingExecutable = missingExecutable;
  }
  return result;
}

function buildMissingLine(name: string): string {
  return `missing executable or Python module ${name} in reveng-sandbox:1: add it to sandbox-image/Dockerfile`;
}

test("test_run_reply_with_a_missing_executable_shows_the_line_with_the_name", async () => {
  // A run reply has one result that names the missing program numpy.
  openFreshPage();
  const reply: WireScriptReplayRunReply = { results: [makeTaskResult("t1", "numpy")] };
  const pending = openMissingExecutablesNotice(reply);
  // The popup shows its title and the exact line with the name.
  assert.ok(readPopupText().includes("Programs missing from the script image"));
  assert.ok(readPopupText().includes(buildMissingLine("numpy")));
  clickOverlayButton("Close");
  await pending;
});

test("test_each_missing_name_shows_once", async () => {
  // Three results name numpy, then pandas, then numpy again.
  openFreshPage();
  const reply: WireScriptReplayRunReply = { results: [makeTaskResult("t1", "numpy"), makeTaskResult("t2", "pandas"), makeTaskResult("t3", "numpy")] };
  const pending = openMissingExecutablesNotice(reply);
  // Each name shows once, numpy before pandas.
  const popupText = readPopupText();
  assert.equal(popupText.split(buildMissingLine("numpy")).length - 1, 1);
  assert.equal(popupText.split(buildMissingLine("pandas")).length - 1, 1);
  assert.ok(popupText.indexOf(buildMissingLine("numpy")) < popupText.indexOf(buildMissingLine("pandas")));
  clickOverlayButton("Close");
  await pending;
});

test("test_no_popup_when_no_name_is_missing", async () => {
  // A run reply has results and none names a missing program.
  openFreshPage();
  const reply: WireScriptReplayRunReply = { results: [makeTaskResult("t1"), makeTaskResult("t2")] };
  // The promise resolves at once and no popup shows.
  await openMissingExecutablesNotice(reply);
  assert.equal(readOverlayCount(), 0);
});

test("test_close_button_closes_the_popup_and_resolves", async () => {
  // Open the popup for one missing name.
  openFreshPage();
  let hasResolved = false;
  const pending = openMissingExecutablesNotice({ results: [makeTaskResult("t1", "numpy")] }).then(() => {
    hasResolved = true;
  });
  // The popup has one button, Close, and the promise has not resolved yet.
  await Promise.resolve();
  assert.deepEqual(listPopupButtonLabels(), ["Close"]);
  assert.equal(hasResolved, false);
  // Clicking Close removes the popup and resolves the promise.
  clickOverlayButton("Close");
  await pending;
  assert.equal(hasResolved, true);
  assert.equal(readOverlayCount(), 0);
});

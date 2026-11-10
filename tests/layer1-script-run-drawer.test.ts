// Task 356: the script-run drawer module: its path lookup, diff panes, language title and highlighting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { buildChangedNoBubbleSection, buildScriptRunDetail, buildScriptRunDiffPanes, listScriptRunPaths } from "../webapp/layer1-components/details-drawer/layer1-script-run-drawer.ts";
import { isRunStarted, loadSavedRunResult, markRunStarted, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireFileChange, WireRunOutcome, WireRunStreamKind, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { SCRIPT_RUN, openSingleRunDrawer } from "./layer1-drawer-script-helpers.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";

const VIEW: WireLayer1View = {
  pairs: [{
    path: "src/a.ts",
    commits: [{ hash: "aaaaaaaabbbbbbbb", instant: T0, axisPx: 0 }, { hash: "ccccccccdddddddd", instant: T1, axisPx: 22 }],
    onDisk: { instant: T2, axisPx: 44 },
  }],
  gitOrphans: [], diskOrphans: [], ruler: [],
};

test("listScriptRunPaths finds every pair carrying this run's toolUseId, in path order", () => {
  const view: WireLayer1View = {
    pairs: [
      { path: "src/a.ts", commits: [], onDisk: { instant: T0, axisPx: 0 }, scriptRuns: [{ ...SCRIPT_RUN, toolUseId: "toolu_1" }] },
      { path: "src/b.ts", commits: [], onDisk: { instant: T0, axisPx: 0 }, scriptRuns: [{ ...SCRIPT_RUN, toolUseId: "toolu_1" }] },
      { path: "src/c.ts", commits: [], onDisk: { instant: T0, axisPx: 0 } },
    ],
    gitOrphans: [], diskOrphans: [], ruler: [],
  };
  assert.deepEqual(listScriptRunPaths(view, "toolu_1"), ["src/a.ts", "src/b.ts"]);
});

function buildReplayedResult(files: WireScriptResult["files"]): WireScriptResult {
  return {
    kind: WireRunStreamKind.result, toolUseId: "toolu_nb", outcome: WireRunOutcome.replayed, files,
    stdout: "", stderr: "", timedOut: false, isOutputSaved: true,
  };
}

test("test_script_run_drawer_lists_changed_files_with_no_bubble", () => {
  // Scenario: a replayed result lists A (a pair in the view) and X (no pair).
  initLayer1Dom();
  resetRunResults();
  const view: WireLayer1View = {
    pairs: [{ path: "src/a.ts", commits: [], onDisk: { instant: T0, axisPx: 0 }, scriptRuns: [{ ...SCRIPT_RUN, toolUseId: "toolu_nb" }] }],
    gitOrphans: [], diskOrphans: [], ruler: [],
  };
  storeRunResult(view, buildReplayedResult([
    { path: "src/a.ts", change: WireFileChange.changed, confidence: WireConfidence.verified },
    { path: "src/x.ts", change: WireFileChange.deleted },
  ]));
  // The drawer shows one section "Changed, no bubble" with X and its change kind.
  const sections = buildChangedNoBubbleSection(view, "toolu_nb");
  assert.equal(sections.length, 1);
  const text = sections[0]!.textContent ?? "";
  assert.ok(text.includes("Changed, no bubble"));
  assert.ok(text.includes("src/x.ts"));
  assert.ok(text.includes("deleted"));
  // The drawer does not list A there.
  assert.ok(!text.includes("src/a.ts"));
});

test("test_script_run_drawer_shows_no_changed_no_bubble_section_when_every_file_has_a_bubble", () => {
  // Scenario: the only changed file is a pair in the view, and a second run has no stored result.
  initLayer1Dom();
  resetRunResults();
  const view: WireLayer1View = {
    pairs: [{ path: "src/a.ts", commits: [], onDisk: { instant: T0, axisPx: 0 }, scriptRuns: [{ ...SCRIPT_RUN, toolUseId: "toolu_nb" }] }],
    gitOrphans: [], diskOrphans: [], ruler: [],
  };
  storeRunResult(view, buildReplayedResult([{ path: "src/a.ts", change: WireFileChange.changed, confidence: WireConfidence.verified }]));
  // The drawer shows no section for either run.
  assert.equal(buildChangedNoBubbleSection(view, "toolu_nb").length, 0);
  assert.equal(buildChangedNoBubbleSection(view, "toolu_none").length, 0);
});

function countConsoleButtons(run: WireScriptRun): number {
  initLayer1Dom();
  return buildScriptRunDetail(run, () => undefined).filter((element) => element.querySelector(".run-console-open") !== null).length;
}

test("buildScriptRunDetail shows the run console button only after a python run started", () => {
  // Verify: absent before the start, present after it, and still present once the run holds a confidence.
  resetRunResults();
  assert.equal(countConsoleButtons(SCRIPT_RUN), 0);
  markRunStarted(SCRIPT_RUN.toolUseId);
  assert.equal(countConsoleButtons(SCRIPT_RUN), 1);
  assert.equal(countConsoleButtons({ ...SCRIPT_RUN, confidence: "mismatch" }), 1);
});

test("test_script_run_drawer_shows_the_console_button_for_a_saved_result_this_page_never_started", () => {
  // Scenario: a page reload restores a replayed result from the server, so no run was started on this page.
  resetRunResults();
  assert.equal(countConsoleButtons(SCRIPT_RUN), 0);
  loadSavedRunResult({ ...buildReplayedResult([]), toolUseId: SCRIPT_RUN.toolUseId });
  assert.equal(isRunStarted(SCRIPT_RUN.toolUseId), false);
  // The drawer still shows the button, so the saved output note can be read.
  assert.equal(countConsoleButtons(SCRIPT_RUN), 1);
});

test("buildScriptRunDetail never shows the run console button for a bash run or a javascript run", () => {
  // Verify: bash is excluded by its executor even when marked started; javascript never starts.
  resetRunResults();
  markRunStarted("toolu_bash");
  assert.equal(countConsoleButtons({ ...SCRIPT_RUN, toolUseId: "toolu_bash", executorKind: "bash", language: "bash" }), 0);
  assert.equal(countConsoleButtons({ ...SCRIPT_RUN, toolUseId: "toolu_js", language: "javascript" }), 0);
});

test("buildScriptRunDiffPanes renders one pane per affected path, bracketed on the run instant", async () => {
  initLayer1Dom();
  Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; } });
  Object.assign(globalThis, {
    fetch: async (url: unknown): Promise<Response> => {
      const payload = String(url).includes("layer1-diff-content") ? { diff: "" } : { content: "x" };
      return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
    },
  });
  const panes = buildScriptRunDiffPanes(VIEW, "2026-07-01T10:30:00.000Z", ["src/a.ts"]);
  assert.equal(panes.length, 1);
  // showPair resolves its content over two drained turns (tests/layer1-drawer.test.ts precedent).
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(panes[0]!.querySelector(".dpair")?.textContent, "aaaaaaaa - cccccccc");
});

test("an unlabeled run's title reads its language: shell run, typescript run, and bash run for the Bash tool", async () => {
  for (const [language, title] of [["shell", "shell run"], ["typescript", "typescript run"], ["bash", "bash run"]] as const) {
    const body = await openSingleRunDrawer({ ...SCRIPT_RUN, toolUseId: "toolu_lang", label: undefined, language, code: "x" });
    assert.equal(getRequiredElementById("dpath").firstChild?.textContent, title);
    assert.equal(body.querySelector(".scriptbody .sbhead b")?.textContent, title);
    const executorRow = [...body.querySelectorAll("dl.script-meta dt")].find((term) => term.textContent === "executor");
    assert.equal(executorRow?.nextElementSibling?.textContent, title);
  }
});

test("the script body is highlighted for python, shell, javascript and typescript, and plain for ruby", async () => {
  const highlighted: string[] = [];
  Object.assign(globalThis, {
    hljs: {
      getLanguage: (name: string) => name === "ruby" ? undefined : {},
      highlight: (code: string, options: { language: string }) => {
        // The diff panes highlight the file's own text too; only the script body's call is recorded.
        if (code === "code") {
          highlighted.push(options.language);
        }
        return { value: `<span class="hljs-keyword">${code}</span>` };
      },
    },
  });
  const openWith = (language: WireScriptRun["language"]): Promise<HTMLElement> =>
    openSingleRunDrawer({ ...SCRIPT_RUN, toolUseId: "toolu_lang", label: undefined, language, code: "code" });
  try {
    for (const [language, hljsLanguage] of [["python", "python"], ["shell", "bash"], ["bash", "bash"], ["javascript", "javascript"], ["typescript", "typescript"]] as const) {
      const body = await openWith(language);
      assert.ok(body.querySelector(".scriptbody pre .hljs-keyword"), language);
      assert.equal(highlighted.at(-1), hljsLanguage);
    }
    const plain = await openWith("ruby");
    assert.equal(plain.querySelector(".scriptbody pre .hljs-keyword"), null);
    assert.equal(plain.querySelector(".scriptbody pre")?.textContent, "code");
  } finally {
    Reflect.deleteProperty(globalThis, "hljs");
  }
});

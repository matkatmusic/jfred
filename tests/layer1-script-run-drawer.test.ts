// Task 356: the script-run drawer module: its path lookup, diff panes, language title and highlighting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getRequiredElementById } from "../webapp/app-dom.ts";
import { buildScriptRunDiffPanes, listScriptRunPaths } from "../webapp/layer1-script-run-drawer.ts";
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

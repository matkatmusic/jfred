// Task 356: ticking the Script run box fetches the runs once and the pair bubbles draw hollow-ring nodes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const COMMIT = { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 60 };
const PYTHON_RUN = { instant: "2026-06-02T10:00:00.000Z", toolUseId: "toolu_fixture_py_rewrite", executorKind: "python", language: "python",
  code: "import pathlib", label: "python run rewrite.py", sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl" };
const BASH_RUN = { instant: "2026-06-02T11:00:00.000Z", toolUseId: "toolu_fixture_sh_inline", executorKind: "bash", language: "bash",
  code: "cat <<'EOF' > src/plain.ts", sessionId: "fixture-b21d84c5", sessionFile: "/fixture/demo/projects/b21d84c5.jsonl" };

const VIEW = {
  pairs: [
    { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK },
    { path: "src/plain.ts", commits: [COMMIT], onDisk: ON_DISK },
    { path: "src/free.ts", commits: [COMMIT], onDisk: ON_DISK },
  ],
  gitOrphans: [],
  diskOrphans: [],
  ruler: [COMMIT, ON_DISK].map((node) => ({ instant: node.instant, axisPx: node.axisPx, eventCount: 3 })),
};

let scriptRunRequests = 0;

async function loadPage(): Promise<void> {
  scriptRunRequests = 0;
  initLayer1Dom("?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj");
  stubStreamRoute("/api/layer1-view", [VIEW]);
  const viewFetch = globalThis.fetch;
  stubStreamRoute("/api/layer1-edits", [{ pairs: [] }]);
  const editsFetch = globalThis.fetch;
  stubStreamRoute("/api/layer1-script-runs", [{ pairs: [
    { path: "src/run.ts", scriptRuns: [PYTHON_RUN] },
    { path: "src/plain.ts", scriptRuns: [BASH_RUN] },
  ] }]);
  const scriptRunFetch = globalThis.fetch;
  Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
    const isScriptRunRequest = String(url).includes("/api/layer1-script-runs");
    scriptRunRequests += isScriptRunRequest ? 1 : 0;
    const isEditsRequest = String(url).includes("/api/layer1-edits");
    return (isScriptRunRequest ? scriptRunFetch : isEditsRequest ? editsFetch : viewFetch)(url as string, init);
  } });
  const { bootLayer1Page } = await import("../webapp/layer1-page.ts");
  bootLayer1Page();
  await waitForAsyncWork();
}

function listMatching(selector: string): HTMLElement[] {
  return [...document.querySelectorAll(selector)] as HTMLElement[];
}

async function tickScriptRunBox(): Promise<void> {
  const box = document.querySelector<HTMLInputElement>("#show-row [data-kind=script-run]")!;
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitForAsyncWork();
}

function readBubble(path: string): HTMLElement {
  return listMatching("#stage .filebox").find((candidate) => candidate.querySelector(".fname")?.getAttribute("data-path") === path)!;
}

function readNodeSignature(path: string): string[] {
  return [...readBubble(path).querySelectorAll(".node, .nlabel")].map((node) => `${node.className}|${node.textContent}`);
}

test("test_before_the_script_run_box_is_ticked_no_script_node_is_drawn_and_nothing_is_fetched", async () => {
  await loadPage();
  assert.equal(listMatching("#stage .n-script").length, 0);
  assert.equal(scriptRunRequests, 0);
  assert.match(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds")!, /script-run/);
});

test("test_ticking_the_script_run_box_draws_a_dot_and_a_label_per_run_after_one_fetch", async () => {
  await loadPage();
  await tickScriptRunBox();
  assert.equal(scriptRunRequests, 1);
  assert.equal(listMatching("#stage .node.n-script").length, 2);
  assert.equal(listMatching("#stage .nlabel.n-script").length, 2);
  assert.doesNotMatch(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds")!, /script-run/);
});

test("test_a_labelled_python_run_shows_its_label_and_a_bash_run_without_a_label_shows_a_dollar_icon", async () => {
  await loadPage();
  await tickScriptRunBox();
  const python = readBubble("src/run.ts").querySelector<HTMLElement>(".nlabel.n-script")!;
  const bash = readBubble("src/plain.ts").querySelector<HTMLElement>(".nlabel.n-script")!;
  assert.equal(python.textContent, "python run rewrite.py");
  assert.equal(python.title, "python run rewrite.py");
  assert.equal(bash.textContent, "$");
  assert.equal(bash.title, "$");
});

test("test_only_a_bash_run_dot_is_never_provable", async () => {
  await loadPage();
  await tickScriptRunBox();
  assert.equal(readBubble("src/run.ts").querySelector(".node.n-script")!.classList.contains("never-provable"), false);
  assert.equal(readBubble("src/plain.ts").querySelector(".node.n-script")!.classList.contains("never-provable"), true);
});

test("test_a_script_run_dot_and_label_carry_the_run_identity", async () => {
  await loadPage();
  await tickScriptRunBox();
  for (const element of listMatching('#stage [data-tool-use-id="toolu_fixture_py_rewrite"]')) {
    assert.equal(element.getAttribute("data-executor-kind"), "python");
    assert.equal(element.getAttribute("data-instant"), PYTHON_RUN.instant);
    assert.equal(element.getAttribute("data-session-id"), "fixture-0f3c9a7e");
    assert.equal(element.getAttribute("data-session-file"), "/fixture/demo/projects/0f3c9a7e.jsonl");
  }
  assert.equal(listMatching('#stage [data-tool-use-id="toolu_fixture_py_rewrite"]').length, 2);
});

test("test_script_run_nodes_take_ruler_offsets_after_the_ladder_start", async () => {
  await loadPage();
  await tickScriptRunBox();
  const offsets = listMatching("#stage .node.n-script").map((node) => Number(node.style.getPropertyValue("--axis-px")));
  assert.equal(offsets.length, 2);
  assert.ok(offsets.every((offset) => Number.isFinite(offset) && offset > 0));
});

test("test_a_pair_without_script_runs_draws_the_same_nodes_before_and_after_the_fetch", async () => {
  await loadPage();
  const before = readNodeSignature("src/free.ts");
  await tickScriptRunBox();
  assert.deepEqual(readNodeSignature("src/free.ts"), before);
});

test("test_the_layer_4_button_ticks_the_edit_box_and_the_script_run_box", async () => {
  await loadPage();
  document.getElementById("layer-4")!.click();
  await waitForAsyncWork();
  assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!.checked, true);
  assert.equal(document.querySelector<HTMLInputElement>("#show-row [data-kind=script-run]")!.checked, true);
  assert.equal(scriptRunRequests, 1);
});

// Test for webapp/layer1-cut-marks.ts: edit dots as marks, and the base save request.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { installCutMarkClick } = await import("../webapp/layer1-components/commits-column/layer1-cut-marks.ts");
const { CUT_REFUSAL_TEXT, CutRefusal } = await import("../webapp/layer1-components/commits-column/layer1-cut-rules.ts");
const { loadJfredBranch, readJfredBranch, setArmed, setBase } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { storeRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");

const BASE_MS = Date.parse("2026-06-01T00:00:00Z");
const HOUR_MS = 3600_000;
const TICK_SPACING_PX = 50;
const FULL_HASH = "abcdef0123456789abcdef0123456789abcdef01";
const PROJECT_DIR = "/work/project";
const FILE_PATH = "src/a.ts";
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
const CANNED_VIEW = { ...EMPTY_VIEW, jfredCommits: { commits: [], isCanned: true as const } };

interface FetchCall {
  url: string;
  method: string;
  body: string;
}

const realFetch = globalThis.fetch;
let fetchCalls: FetchCall[] = [];

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, method: init.method!, body: init.body as string });
    return new Response("{}");
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function buildInstant(hour: number): string {
  return new Date(BASE_MS + hour * HOUR_MS).toISOString();
}

function addTick(hour: number): HTMLElement {
  const axisPx = hour * TICK_SPACING_PX;
  const tick = document.createElement("div");
  tick.className = "tick";
  document.getElementById("ruler")!.append(tick);
  storeRow(tick, { axisPx, text: "t", eventCount: 1, axisPxList: [axisPx], instants: [buildInstant(hour)] });
  return tick;
}

// One file box at axis 0: each node sits at its hour offset, followed by a label span.
function addFileBox(nodes: { hour: number; nodeClass: string; label: string }[]): void {
  const box = document.createElement("div");
  box.className = "filebox";
  box.style.setProperty("--axis-px", "0");
  const name = document.createElement("span");
  name.className = "fname";
  name.dataset["path"] = FILE_PATH;
  box.append(name);
  for (const { hour, nodeClass, label } of nodes) {
    const node = document.createElement("i");
    node.className = nodeClass;
    node.title = FULL_HASH;
    node.dataset["instant"] = buildInstant(hour);
    node.style.setProperty("--axis-px", String(hour * TICK_SPACING_PX));
    const nodeLabel = document.createElement("span");
    nodeLabel.className = "nlabel";
    nodeLabel.textContent = label;
    box.append(node, nodeLabel);
  }
  document.getElementById("stage")!.append(box);
}

// Fresh armed page: hour 1 commit, hour 2 snapshot and hour 3 edit dot of one file.
function buildPage(view: typeof EMPTY_VIEW): HTMLElement[] {
  initLayer1Dom();
  (document.getElementById("dir") as HTMLInputElement).value = PROJECT_DIR;
  loadJfredBranch(view);
  setArmed(true);
  installCutMarkClick();
  const ticks = [addTick(1), addTick(2), addTick(3)];
  addFileBox([{ hour: 1, nodeClass: "node n-commit", label: "[c]" }]);
  addFileBox([
    { hour: 2, nodeClass: "node n-snap", label: "[s]" },
    { hour: 3, nodeClass: "node n-edit", label: "[e]" },
  ]);
  return ticks;
}

test("test_a_tick_that_holds_only_an_edit_dot_accepts_a_mark_and_refuses_a_base", () => {
  // Verify: with no base the edit-only tick is refused as a base, with a base it takes a mark.
  const [, , edit] = buildPage(EMPTY_VIEW);
  edit!.click();
  assert.equal(document.getElementById("dtoast")!.textContent, CUT_REFUSAL_TEXT[CutRefusal.baseNeedsCommit]);
  assert.equal(readJfredBranch().base, undefined);
  setBase({ instant: buildInstant(1), shortHash: "abcdef01" });
  edit!.click();
  assert.equal(readJfredBranch().pending?.instant, buildInstant(3));
});

test("test_the_mark_message_lists_the_edit_dot_as_the_files_latest_dot", () => {
  // Verify: the snapshot at hour 2 loses to the later edit dot at hour 3.
  const [, , edit] = buildPage(EMPTY_VIEW);
  setBase({ instant: buildInstant(1), shortHash: "abcdef01" });
  edit!.click();
  const { message } = readJfredBranch().pending!;
  assert.match(message, new RegExp(`${FILE_PATH}: \\[e\\] at ${buildInstant(3)}`));
  assert.doesNotMatch(message, /\[s\]/);
});

test("test_placing_a_mark_sends_no_request", () => {
  // Verify: a forward mark only changes the page, and posts nothing.
  const [, , edit] = buildPage(EMPTY_VIEW);
  setBase({ instant: buildInstant(1), shortHash: "abcdef01" });
  edit!.click();
  assert.deepEqual(fetchCalls, []);
});

test("test_placing_the_base_on_a_real_branch_saves_the_full_commit_hash", () => {
  // Verify: the one settings request carries the project dir and all 40 hash characters.
  const [commit] = buildPage(EMPTY_VIEW);
  commit!.click();
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]!.url, "/api/layer1-settings");
  assert.equal(fetchCalls[0]!.method, "POST");
  assert.deepEqual(JSON.parse(fetchCalls[0]!.body), { dir: PROJECT_DIR, jfredBaseHash: FULL_HASH });
  assert.equal(readJfredBranch().base?.shortHash, FULL_HASH.slice(0, 8));
});

test("test_placing_the_base_on_a_canned_branch_sends_no_request", () => {
  // Verify: the canned base is set on the page, and nothing is saved.
  const [commit] = buildPage(CANNED_VIEW);
  commit!.click();
  assert.equal(readJfredBranch().base?.shortHash, FULL_HASH.slice(0, 8));
  assert.deepEqual(fetchCalls, []);
});

// Task 343: ticking the Edit box fetches the edits once and the pair bubbles draw [e] and [R]✓ nodes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForAsyncWork, initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { stubStreamRoute } from "./webapp-fetch-test-helpers.ts";

const COMMIT = { hash: "b7c8d9e0f1a23445566778899aabbccddeeff001", instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };
const ON_DISK = { instant: "2026-06-03T09:00:00.000Z", axisPx: 60 };
const READ = { instant: "2026-06-02T11:00:00.000Z", kind: "read", changeId: "toolu_fixture_001", confidence: "verified",
  sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl", line: 30 };
const EDIT = { instant: "2026-06-02T12:00:00.000Z", kind: "edit", changeId: "toolu_fixture_002", confidence: "verified",
  sessionId: "fixture-0f3c9a7e", sessionFile: "/fixture/demo/projects/0f3c9a7e.jsonl", line: 44 };
const RESEEDED = { instant: "2026-06-02T14:00:00.000Z", kind: "edit", changeId: "toolu_fixture_005", confidence: "reseeded",
  sessionId: "fixture-b21d84c5", sessionFile: "/fixture/demo/projects/b21d84c5.jsonl", line: 300 };
const STALE = { instant: "2026-06-02T13:00:00.000Z", kind: "edit", changeId: "toolu_fixture_003", confidence: "derived",
  sessionId: "fixture-b21d84c5", sessionFile: "/fixture/demo/projects/b21d84c5.jsonl", line: 280 };

const BOTH_ROOTS_SEARCH = "?dir=%2Fw%2Fproj&repo=%2Fw%2Fproj";
const VIEW = {
  pairs: [
    { path: "src/run.ts", commits: [COMMIT], onDisk: ON_DISK },
    { path: "src/plain.ts", commits: [COMMIT], onDisk: ON_DISK },
  ],
  gitOrphans: [],
  diskOrphans: [],
  ruler: [COMMIT, ON_DISK].map((node) => ({ instant: node.instant, axisPx: node.axisPx, eventCount: 2 })),
};

let editRequests = 0;

async function loadPage(edits: object[] = [READ, EDIT, STALE]): Promise<void> {
  editRequests = 0;
  initLayer1Dom(BOTH_ROOTS_SEARCH);
  stubStreamRoute("/api/layer1-view", [VIEW]);
  const viewFetch = globalThis.fetch;
  stubStreamRoute("/api/layer1-edits", [{ pairs: [{ path: "src/run.ts", edits }] }]);
  const editsFetch = globalThis.fetch;
  Object.assign(globalThis, { fetch: (url: unknown, init?: RequestInit) => {
    const isEditsRequest = String(url).includes("/api/layer1-edits");
    editRequests += isEditsRequest ? 1 : 0;
    return (isEditsRequest ? editsFetch : viewFetch)(url as string, init);
  } });
  const { initLayer1Page } = await import("../webapp/layer1-page.ts");
  initLayer1Page();
  await waitForAsyncWork();
}

function listMatching(selector: string): HTMLElement[] {
  return [...document.querySelectorAll(selector)] as HTMLElement[];
}

function readEditBox(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("#show-row [data-kind=edit]")!;
}

async function tickEditBox(): Promise<void> {
  const box = readEditBox();
  box.checked = true;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitForAsyncWork();
}

function readNodeSignature(path: string): string[] {
  const bubble = listMatching("#stage .filebox").find((candidate) => candidate.querySelector(".fname")?.getAttribute("data-path") === path)!;
  return [...bubble.querySelectorAll(".node, .nlabel")].map((node) => `${node.className}|${node.textContent}`);
}

test("test_before_the_edit_box_is_ticked_no_edit_node_is_drawn_and_nothing_is_fetched", async () => {
  await loadPage();
  assert.equal(readEditBox().checked, false);
  assert.equal(listMatching("#stage .n-edit, #stage .n-read").length, 0);
  assert.equal(editRequests, 0);
});

test("test_ticking_the_edit_box_draws_one_labelled_node_per_event_after_one_fetch", async () => {
  await loadPage();
  await tickEditBox();
  assert.equal(editRequests, 1);
  assert.deepEqual(listMatching("#stage .nlabel.n-edit, #stage .nlabel.n-read").map((label) => label.textContent), ["[R]✓", "[e]", "[e]"]);
  assert.equal(listMatching("#stage .node.n-edit").length, 2);
  assert.equal(listMatching("#stage .node.n-read").length, 1);
  assert.equal(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds"), "script-run branch");
});

test("test_an_edit_node_carries_its_identity_and_confidence_on_the_dot_and_the_label", async () => {
  await loadPage();
  await tickEditBox();
  for (const element of listMatching('#stage [data-change-id="toolu_fixture_003"]')) {
    assert.equal(element.getAttribute("data-kind"), "edit");
    assert.equal(element.getAttribute("data-confidence"), "derived");
    assert.equal(element.getAttribute("data-session-id"), "fixture-b21d84c5");
    assert.equal(element.getAttribute("data-session-file"), "/fixture/demo/projects/b21d84c5.jsonl");
    assert.equal(element.getAttribute("data-line"), "280");
    assert.equal(element.getAttribute("data-instant"), STALE.instant);
  }
  assert.ok(listMatching("#stage .node.n-edit")[1]!.classList.contains("conf-derived"));
  assert.ok(listMatching("#stage .node.n-edit")[0]!.classList.contains("conf-verified"));
});

test("test_a_reseeded_edit_draws_a_conf_reseeded_node", async () => {
  await loadPage([RESEEDED]);
  await tickEditBox();
  const node = listMatching("#stage .node.n-edit")[0]!;
  assert.equal(node.getAttribute("data-confidence"), "reseeded");
  assert.ok(node.classList.contains("conf-reseeded"));
});

test("test_edit_nodes_take_ruler_offsets_in_instant_order", async () => {
  await loadPage();
  await tickEditBox();
  const offsets = listMatching("#stage .node.n-read, #stage .node.n-edit").map((node) => Number(node.style.getPropertyValue("--axis-px")));
  assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right));
  assert.equal(new Set(offsets).size, 3);
});

test("test_a_pair_without_edits_draws_the_same_nodes_before_and_after_the_fetch", async () => {
  await loadPage();
  const before = readNodeSignature("src/plain.ts");
  await tickEditBox();
  assert.deepEqual(readNodeSignature("src/plain.ts"), before);
});

test("test_unticking_hides_the_edit_nodes_and_ticking_again_never_fetches_again", async () => {
  await loadPage();
  await tickEditBox();
  const box = readEditBox();
  box.checked = false;
  box.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds"), "script-run branch edit");
  await tickEditBox();
  assert.equal(editRequests, 1);
  assert.equal(document.querySelector(".viz-root")!.getAttribute("data-hidden-kinds"), "script-run branch");
});

test("test_the_layer_3_button_ticks_only_the_edit_box_and_does_nothing_when_it_is_already_on", async () => {
  await loadPage();
  document.getElementById("layer-3")!.click();
  await waitForAsyncWork();
  assert.equal(readEditBox().checked, true);
  assert.equal(editRequests, 1);
  assert.deepEqual(listMatching("#show-row input").filter((box) => !(box as HTMLInputElement).checked).map((box) => box.dataset["kind"]), ["script-run", "branch"]);
  document.getElementById("layer-3")!.click();
  await waitForAsyncWork();
  assert.equal(readEditBox().checked, true);
  assert.equal(editRequests, 1);
});

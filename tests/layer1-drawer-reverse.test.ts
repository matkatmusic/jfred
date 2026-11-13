// A reverse node opens the drawer on that file state, diffed against the next older state.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { installNodeDrawer } from "../webapp/layer1-components/details-drawer/layer1-drawer.ts";
import { clearReverseWalks, storeReverseWalk } from "../webapp/layer1-reverse-store.ts";
import { WireReverseKind, type WireReverseState } from "../webapp/layer1-wire-reverse.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { getFirstPane, installAnimationFrameStub, installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";

const REVERSE_PATH = "src/util.ts";
const SESSION_FILE = "/fixture/demo/projects/b21d84c5.jsonl";
const INSTANT_EDIT = "2026-07-01T12:00:00.000Z";
const INSTANT_WRITE = "2026-07-01T11:00:00.000Z";
const COMMIT_HASH = "80890a1b2c3d4e5f60718293a4b5c6d7e8f90123";

const REVERSE_STATES: WireReverseState[] = [
  { index: 0, kind: WireReverseKind.DiskNow, content: "now text" },
  { index: 1, kind: WireReverseKind.EditUndone, instant: INSTANT_EDIT, content: "before edit text", jsonlPath: SESSION_FILE, lineNumber: 58 },
  { index: 2, kind: WireReverseKind.WriteUndone, instant: INSTANT_WRITE, content: "before write text" },
  { index: 3, kind: WireReverseKind.FileCreated, instant: "2026-07-01T10:00:00.000Z" },
];

function buildReverseNode(index: number, extra: Record<string, string> = {}): HTMLElement {
  const node = createElement("i", { class: "node n-rev", "data-index": String(index), "data-kind": REVERSE_STATES[index]!.kind, ...extra });
  getRequiredElementById("fileBubbleContainer").replaceChildren(createElement("div", { class: "filebox" }, [
    createElement("div", { class: "fname", text: "util.ts", "data-path": REVERSE_PATH }),
    createElement("div", { class: "lane" }, [node, createElement("span", { class: "nlabel", text: "state" })]),
  ]));
  return node;
}

function setUpReversePage(contentFor: (params: URLSearchParams) => object = () => ({})): { url: string; body?: string }[] {
  initLayer1Dom();
  installAnimationFrameStub();
  clearReverseWalks();
  storeReverseWalk({ path: REVERSE_PATH, states: REVERSE_STATES });
  installNodeDrawer();
  return installRecordingFetch(contentFor);
}

async function clickNode(node: HTMLElement): Promise<void> {
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitForPendingFetches();
}

function readDiffAsk(asks: { url: string; body?: string }[]): { base: string; target: string } {
  const ask = asks.find((entry) => entry.url.includes("layer1-diff-content"))!;
  const { base, target } = JSON.parse(ask.body!) as { base: string; target: string };
  return { base, target };
}

test("test_clicking_a_reverse_node_opens_the_drawer", async () => {
  // Steps: set up a walk and a stage with one reverse node; click the node; the drawer is open.
  setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.ok(getRequiredElementById("detailsPaneContainer").classList.contains("open"));
});

test("test_reverse_drawer_header_names_the_path", async () => {
  // Steps: click a reverse node; the header text is the file path.
  setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.equal(getRequiredElementById("dpath").textContent, REVERSE_PATH);
});

test("test_reverse_drawer_meta_names_state_kind_and_instant", async () => {
  // Steps: click the edit-undone state (second of four); the meta line names its place, kind and instant.
  setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.equal(getRequiredElementById("dmeta").textContent, `state 2 of 4 · before edit · ${INSTANT_EDIT}`);
});

test("test_reverse_drawer_meta_says_now_for_the_disk_state", async () => {
  // Steps: click the disk-now state, which has no instant; the meta line says "now".
  setUpReversePage();
  await clickNode(buildReverseNode(0));
  assert.equal(getRequiredElementById("dmeta").textContent, "state 1 of 4 · on disk now · now");
});

test("test_reverse_drawer_meta_uses_kind_words_for_each_kind", async () => {
  // Steps: click each state in turn; the middle part of the meta line is that kind's words.
  setUpReversePage();
  const kindWords = ["on disk now", "before edit", "before write", "file did not exist"];
  for (const [index, words] of kindWords.entries()) {
    await clickNode(buildReverseNode(index));
    assert.equal(getRequiredElementById("dmeta").textContent?.split(" · ")[1], words);
  }
});

test("test_reverse_drawer_meta_names_the_short_hash_for_a_git_commit_state", async () => {
  // Steps: store a walk whose second state is a git commit; click it; the kind words are "commit" and the 7-character hash.
  setUpReversePage();
  storeReverseWalk({ path: REVERSE_PATH, states: [REVERSE_STATES[0]!, { index: 1, kind: WireReverseKind.GitCommit, instant: INSTANT_EDIT, commitHash: COMMIT_HASH, content: "commit text" }] });
  await clickNode(buildReverseNode(1));
  assert.equal(getRequiredElementById("dmeta").textContent, `state 2 of 2 · commit 80890a1 · ${INSTANT_EDIT}`);
});

test("test_reverse_drawer_meta_says_snapshot_for_a_backup_snapshot_state", async () => {
  // Steps: store a walk whose second state is a backup snapshot; click it; the kind words are "snapshot".
  setUpReversePage();
  storeReverseWalk({ path: REVERSE_PATH, states: [REVERSE_STATES[0]!, { index: 1, kind: WireReverseKind.BackupSnapshot, instant: INSTANT_EDIT, content: "snapshot text" }] });
  await clickNode(buildReverseNode(1));
  assert.equal(getRequiredElementById("dmeta").textContent, `state 2 of 2 · snapshot · ${INSTANT_EDIT}`);
});

test("test_reverse_drawer_diffs_the_older_state_against_the_clicked_state", async () => {
  // Steps: click the edit-undone state; the diff request has the next older state as base and the clicked state as target.
  const asks = setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.deepEqual(readDiffAsk(asks), { base: "before write text", target: "before edit text" });
});

test("test_reverse_drawer_diffs_against_empty_text_when_no_older_state_exists", async () => {
  // Steps: click the oldest state, whose content is absent; both sides are empty text.
  const asks = setUpReversePage();
  await clickNode(buildReverseNode(3));
  assert.deepEqual(readDiffAsk(asks), { base: "", target: "" });
});

test("test_reverse_drawer_uses_empty_text_for_an_older_state_without_content", async () => {
  // Steps: click the write-undone state; its older neighbour did not exist, so the base side is empty text.
  const asks = setUpReversePage();
  await clickNode(buildReverseNode(2));
  assert.deepEqual(readDiffAsk(asks), { base: "", target: "before write text" });
});

test("test_reverse_drawer_fetches_only_the_diff_never_file_content", async () => {
  // Steps: click a reverse node; the only request is the diff POST.
  const asks = setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.deepEqual(asks.map((entry) => entry.url), ["/api/layer1-diff-content"]);
});

test("test_reverse_drawer_pair_label_names_both_states", async () => {
  // Steps: click the edit-undone state; the pane's pair label names the older and the clicked state.
  setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.equal(getFirstPane().querySelector(".dpair")?.textContent, "state 3 - state 2");
});

test("test_reverse_drawer_throws_when_the_state_is_not_stored", async () => {
  // Steps: build a node whose index is not in the stored walk; opening it throws.
  setUpReversePage();
  const { openReverseNodeDrawer } = await import("../webapp/layer1-components/details-drawer/layer1-drawer-reverse.ts");
  const node = buildReverseNode(1);
  node.dataset.index = "9";
  assert.throws(() => openReverseNodeDrawer(node, REVERSE_PATH));
});

test("test_reverse_drawer_reveals_the_raw_json_line_when_session_and_line_exist", async () => {
  // Steps: click a node with a session file and line; the { } button fetches that line on click.
  const asks = setUpReversePage((params) => (params.has("line") ? { type: "assistant", note: "reverse record line" } : {}));
  await clickNode(buildReverseNode(1, { "data-session-file": SESSION_FILE, "data-line": "58" }));
  const toggle = getRequiredElementById("dbody").querySelector(".json-toggle") as HTMLButtonElement;
  toggle.click();
  await waitForPendingFetches();
  const recordAsk = new URLSearchParams(asks.find((entry) => entry.url.includes("layer1-record"))!.url.split("?")[1]);
  assert.equal(recordAsk.get("jsonl"), SESSION_FILE);
  assert.equal(recordAsk.get("line"), "58");
});

test("test_reverse_drawer_meta_uses_the_words_for_read_only_and_possible_change", async () => {
  // Steps: show a read-only state and a possible-change state; the middle part of the meta line is that kind's words.
  initLayer1Dom();
  installAnimationFrameStub();
  clearReverseWalks();
  const states: WireReverseState[] = [
    { index: 0, kind: WireReverseKind.ReadOnly, instant: INSTANT_EDIT, content: "a" },
    { index: 1, kind: WireReverseKind.PossibleChange, instant: INSTANT_WRITE, content: "b" },
  ];
  storeReverseWalk({ path: REVERSE_PATH, states });
  installNodeDrawer();
  installRecordingFetch(() => ({}));
  const expectedWords = ["read, no change", "possible change, bytes not known"];
  for (const [index, words] of expectedWords.entries()) {
    const node = createElement("i", { class: "node n-rev", "data-index": String(index), "data-kind": states[index]!.kind });
    getRequiredElementById("fileBubbleContainer").replaceChildren(createElement("div", { class: "filebox" }, [
      createElement("div", { class: "fname", text: "util.ts", "data-path": REVERSE_PATH }),
      createElement("div", { class: "lane" }, [node, createElement("span", { class: "nlabel", text: "state" })]),
    ]));
    await clickNode(node);
    assert.equal(getRequiredElementById("dmeta").textContent?.split(" · ")[1], words);
  }
});

test("test_reverse_drawer_shows_no_raw_json_button_without_a_session_line", async () => {
  // Steps: click a node with no session file or line; there is no { } button.
  setUpReversePage();
  await clickNode(buildReverseNode(1));
  assert.equal(getRequiredElementById("dbody").querySelector(".json-toggle"), null);
});

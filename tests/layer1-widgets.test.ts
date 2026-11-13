// Layer 1 pair bubble: a pair with no created-at node says so at the top of the bubble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-components/bubbles/layer1-created-reason.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WirePair } from "../webapp/layer1-wire.ts";

initLayer1Dom();
const { buildStagePairs, buildOrphanBucket } = await import("../webapp/layer1-widgets.ts");
const { collectStageBubbles } = await import("../webapp/layer1-components/ruler/layer1-ruler-click.ts");
const { listAllEventsAtRow } = await import("../webapp/layer1-components/ruler/layer1-tick-events.ts");

function buildPairWidget(pair: WirePair): HTMLElement {
  return buildStagePairs([pair])[0]!;
}

const INSTANT = { instant: "2026-06-02T09:00:00.000Z", axisPx: 30 };

function buildPair(overrides: Partial<WirePair>): WirePair {
  return { path: "src/run.ts", commits: [], onDisk: INSTANT, ...overrides };
}

test("test_a_pair_with_createdNotTrusted_shows_the_note_first_with_the_reason_as_title", () => {
  // Scenario: no created node, reason birthAfterFirstCommit: the note leads the filebox and its title is that reason's sentence.
  const filebox = buildPairWidget(buildPair({ createdNotTrusted: CreatedNotTrustedReason.birthAfterFirstCommit }));
  const note = filebox.querySelector(".created-untrusted");
  assert.equal(filebox.firstElementChild, note);
  assert.equal(note?.textContent, "creation time not trusted");
  assert.equal(note?.getAttribute("title"), "The birth time is later than the file's first commit.");
});

test("test_each_reason_has_its_own_title_sentence", () => {
  // Scenario: the three reasons give three different sentences.
  const titles = new Set<string | null | undefined>();
  for (const reason of Object.values(CreatedNotTrustedReason)) {
    const filebox = buildPairWidget(buildPair({ createdNotTrusted: reason }));
    titles.add(filebox.querySelector(".created-untrusted")?.getAttribute("title"));
  }
  assert.equal(titles.size, 3);
  assert.equal(titles.has(undefined), false);
});

const TOOL_USE = { id: "l7-tool-0", kind: WireRecordKind.toolUse, pairId: "toolu_fixture_l7_grep", label: "Grep", instant: "2026-06-02T08:00:00.000Z", axisPx: 10 };
const TOOL_RESULT = { ...TOOL_USE, id: "l7-tool-1", kind: WireRecordKind.toolResult, instant: "2026-06-02T08:30:00.000Z", axisPx: 20 };

test("test_a_pair_with_tool_nodes_draws_them_in_the_lane_and_startPx_includes_them", () => {
  // Scenario: tool nodes at 10 and 20 precede the disk node at 30, so the bubble starts at 10.
  const filebox = buildPairWidget(buildPair({ toolNodes: [TOOL_USE, TOOL_RESULT] }));
  assert.equal(filebox.style.getPropertyValue("--axis-px"), "10");
  const dots = filebox.querySelectorAll<HTMLElement>(".lane .tnode");
  assert.equal(dots.length, 2);
  assert.equal(dots[0]!.style.getPropertyValue("--axis-px"), "0");
  assert.equal(dots[1]!.style.getPropertyValue("--axis-px"), "10");
  assert.equal(filebox.querySelectorAll(".lane .tbracket").length, 1);
});

test("test_a_pair_without_tool_nodes_draws_none", () => {
  // Scenario: real data never sets toolNodes, so the lane holds no tool pieces.
  const filebox = buildPairWidget(buildPair({}));
  assert.equal(filebox.querySelector(".tnode, .tlabel, .tbracket"), null);
});

test("test_a_pair_with_a_created_node_shows_no_note", () => {
  // Scenario: created is set, so the bubble has no created-untrusted note.
  const filebox = buildPairWidget(buildPair({ created: INSTANT }));
  assert.equal(filebox.querySelector(".created-untrusted"), null);
});

const EARLY_ORPHAN = { path: "a/early.py", instant: "2026-06-02T08:00:00.000Z", axisPx: 100 };
const LATE_ORPHAN = { path: "b/late.py", instant: "2026-06-02T09:00:00.000Z", axisPx: 400 };
const SHARED_FIRST = { path: "c/first.py", instant: "2026-06-02T10:00:00.000Z", axisPx: 700 };
const SHARED_SECOND = { ...SHARED_FIRST, path: "c/second.py" };
const SHARED_THIRD = { ...SHARED_FIRST, path: "c/third.py" };

function listRowLines(bucket: HTMLElement): HTMLElement[] {
  return [...bucket.querySelectorAll<HTMLElement>(":scope > .orphan-rows > li")];
}

test("test_each_orphan_row_sits_at_its_own_instant_offset_from_the_bucket_start", () => {
  // Scenario: two files 300 px apart; the bucket starts at the first, the second row is 300 px below it.
  const bucket = buildOrphanBucket("No on-disk match", [EARLY_ORPHAN, LATE_ORPHAN])!;
  const lines = listRowLines(bucket);
  assert.deepEqual(lines.map((line) => line.style.getPropertyValue("--axis-px")), ["0", "300"]);
});

test("test_orphan_bucket_spans_from_its_earliest_row_to_its_latest_row", () => {
  // Scenario: absolutely placed rows add no height, so the row holder carries the span, as a pair's lane does.
  const bucket = buildOrphanBucket("No on-disk match", [EARLY_ORPHAN, LATE_ORPHAN])!;
  const rowHolder = bucket.querySelector<HTMLElement>(".orphan-rows")!;
  assert.equal(rowHolder.style.getPropertyValue("--span-px"), "300");
});

test("test_files_sharing_one_instant_draw_one_line_with_the_first_name_and_a_more_count", () => {
  // Scenario: three files at one instant make one line: first name, then "+2 more".
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, SHARED_SECOND, SHARED_THIRD])!;
  const lines = listRowLines(bucket);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.querySelector("span")?.textContent, "c/first.py");
  assert.equal(lines[0]!.querySelector("button")?.textContent, "+2 more");
});

test("test_a_file_alone_at_its_instant_has_no_more_button", () => {
  // Scenario: one file at an instant needs no "+N more".
  const bucket = buildOrphanBucket("No on-disk match", [EARLY_ORPHAN, LATE_ORPHAN])!;
  assert.equal(bucket.querySelector("button"), null);
});

test("test_clicking_more_shows_the_other_names_and_a_second_click_hides_them", () => {
  // Scenario: the other two names appear after one click and disappear after the next.
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, SHARED_SECOND, SHARED_THIRD])!;
  const moreButton = bucket.querySelector<HTMLElement>("button")!;
  const popup = bucket.querySelector<HTMLElement>(".more-files")!;
  assert.equal(popup.classList.contains("open"), false);
  moreButton.click();
  assert.equal(popup.classList.contains("open"), true);
  assert.deepEqual([...popup.querySelectorAll("li span")].map((name) => name.textContent), ["c/second.py", "c/third.py"]);
  moreButton.click();
  assert.equal(popup.classList.contains("open"), false);
});

test("test_every_file_at_a_shared_instant_is_found_by_the_ruler_row_lookup", () => {
  // Scenario: the ruler click lists the files drawn at 700 px; all three names must come back.
  const bucket = buildOrphanBucket("No repository match", [SHARED_FIRST, SHARED_SECOND, SHARED_THIRD])!;
  document.getElementById("stage")!.replaceChildren(bucket);
  const events = listAllEventsAtRow([SHARED_FIRST.axisPx], collectStageBubbles());
  assert.deepEqual(events.map((event) => event.path), ["c/first.py", "c/second.py", "c/third.py"]);
});

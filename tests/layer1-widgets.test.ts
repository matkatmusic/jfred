// Layer 1 pair bubble: a pair with no created-at node says so at the top of the bubble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";
import type { WirePair } from "../webapp/layer1-wire.ts";

initLayer1Dom();
const { buildStagePairs } = await import("../webapp/layer1-widgets.ts");

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

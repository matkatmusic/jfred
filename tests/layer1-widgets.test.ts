// Layer 1 pair bubble: a pair with no created-at node says so at the top of the bubble.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { CreatedNotTrustedReason } from "../webapp/layer1-created-reason.ts";
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

test("test_a_pair_with_a_created_node_shows_no_note", () => {
  // Scenario: created is set, so the bubble has no created-untrusted note.
  const filebox = buildPairWidget(buildPair({ created: INSTANT }));
  assert.equal(filebox.querySelector(".created-untrusted"), null);
});

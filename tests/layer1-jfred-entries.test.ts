// Test for webapp/layer1-jfred-entries.ts: one node, label and line per column entry, joined by chain segments.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { buildJfredEntries, listJfredEntries, JfredEntryKind } = await import("../webapp/layer1-jfred-entries.ts");
const { computeAxisPixelsAt } = await import("../webapp/layer1-ranges.ts");
const { loadJfredBranch, readJfredBranch, setPending } = await import("../webapp/layer1-jfred-state.ts");

const TICKS: WireRulerTick[] = [
  { instant: "2026-06-01T09:00:00.000Z", axisPx: 100, eventCount: 1 },
  { instant: "2026-06-01T09:05:00.000Z", axisPx: 160, eventCount: 1 },
  { instant: "2026-06-03T10:30:00.000Z", axisPx: 400, eventCount: 1 },
  { instant: "2026-06-03T18:20:00.000Z", axisPx: 480, eventCount: 1 },
];
const EMPTY_VIEW = { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] };
const CANNED_VIEW = {
  ...EMPTY_VIEW,
  jfredCommits: {
    base: { instant: TICKS[0]!.instant, shortHash: "a1b2c3d4" },
    commits: [
      { instant: TICKS[1]!.instant, shortHash: "c0ffee01", parentShortHash: "a1b2c3d4", message: "one" },
      { instant: TICKS[2]!.instant, shortHash: "c0ffee02", parentShortHash: "c0ffee01", message: "two" },
    ],
  },
};

beforeEach(() => {
  initLayer1Dom();
  loadJfredBranch(CANNED_VIEW);
});

function listByClasses(elements: HTMLElement[], ...classNames: string[]): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const element of elements) {
    if (classNames.every((className) => element.classList.contains(className)))
      found.push(element);
  }
  return found;
}

function countByClass(elements: HTMLElement[], className: string): number {
  return listByClasses(elements, className).length;
}

test("test_each_entry_gets_one_node_one_label_and_one_line", () => {
  // Verify: base plus two commits give three of each.
  const elements = buildJfredEntries(readJfredBranch(), TICKS);
  assert.equal(countByClass(elements, "jnode"), 3);
  assert.equal(countByClass(elements, "jlabel"), 3);
  assert.equal(countByClass(elements, "jline"), 3);
});

test("test_the_chain_count_is_entries_minus_one", () => {
  // Verify: a pending mark adds one entry and one more segment, and that segment is dashed.
  assert.equal(countByClass(buildJfredEntries(readJfredBranch(), TICKS), "jchain"), 2);
  setPending({ instant: TICKS[3]!.instant, message: "draft" });
  const elements = buildJfredEntries(readJfredBranch(), TICKS);
  assert.equal(countByClass(elements, "jchain"), 3);
  assert.equal(listByClasses(elements, "jchain", "j-pending").length, 1);
});

test("test_axis_px_matches_the_ruler_position_of_the_instant", () => {
  // Verify: every node sits where computeAxisPixelsAt puts its instant.
  for (const element of buildJfredEntries(readJfredBranch(), TICKS)) {
    if (!element.classList.contains("jnode"))
      continue;
    const wanted = computeAxisPixelsAt(Date.parse(element.dataset["instant"]!), TICKS);
    assert.equal(element.style.getPropertyValue("--axis-px"), String(wanted));
  }
});

test("test_labels_read_base_hash_and_pending", () => {
  // Verify: base reads `base <hash>`, a commit its hash, the pending mark `pending`.
  setPending({ instant: TICKS[3]!.instant, message: "draft" });
  const labels: string[] = [];
  for (const element of buildJfredEntries(readJfredBranch(), TICKS)) {
    if (element.classList.contains("jlabel"))
      labels.push(element.textContent!);
  }
  assert.deepEqual(labels, ["base a1b2c3d4", "c0ffee01", "c0ffee02", "pending"]);
});

test("test_nodes_carry_the_entry_data_attributes", () => {
  // Verify: kind, hash, parent hash and instant are readable from the node.
  const nodes = listByClasses(buildJfredEntries(readJfredBranch(), TICKS), "jnode");
  const second = nodes[2]!;
  assert.equal(second.dataset["entryKind"], JfredEntryKind.commit);
  assert.equal(second.dataset["shortHash"], "c0ffee02");
  assert.equal(second.dataset["parentHash"], "c0ffee01");
  assert.equal(second.dataset["instant"], TICKS[2]!.instant);
  assert.equal(nodes[0]!.dataset["entryKind"], JfredEntryKind.base);
  assert.equal(nodes[0]!.dataset["parentHash"], undefined);
});

test("test_the_pending_entry_has_no_hash_and_the_tip_as_parent", () => {
  // Verify: listJfredEntries ends with the pending entry whose parent is the last commit.
  setPending({ instant: TICKS[3]!.instant, message: "draft" });
  const last = listJfredEntries(readJfredBranch()).at(-1)!;
  assert.equal(last.kind, JfredEntryKind.pending);
  assert.equal(last.shortHash, undefined);
  assert.equal(last.parentShortHash, "c0ffee02");
});

test("test_no_base_gives_no_entries", () => {
  // Verify: an empty branch draws nothing.
  loadJfredBranch(EMPTY_VIEW);
  assert.deepEqual(buildJfredEntries(readJfredBranch(), TICKS), []);
});

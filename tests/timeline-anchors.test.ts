// Session anchor lookup: the first node whose session id prefixes the anchored JSONL name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_findFirstNodeIndexForJsonl_returns_first_matching_session_node", async () => {
  initWebappDom();
  const { findFirstNodeIndexForJsonl } = await import("../webapp/views/timeline-anchors.ts");
  const nodes = [{ sessionId: undefined }, { sessionId: "aaa" }, { sessionId: "bbb" }, { sessionId: "bbb" }] as never;
  assert.equal(findFirstNodeIndexForJsonl(nodes, "bbb.jsonl"), 2);
  assert.equal(findFirstNodeIndexForJsonl(nodes, "zzz.jsonl"), -1);
});

test("test_moveToSessionAnchor_jumps_only_when_a_node_matches", async () => {
  initWebappDom();
  const { moveToSessionAnchor } = await import("../webapp/views/timeline-anchors.ts");
  const jumped: number[] = [];
  const context = { nodes: [{ sessionId: "aaa" }], jumpToTimelineRow: (index: number) => jumped.push(index) } as never;
  moveToSessionAnchor(context, "aaa.jsonl");
  moveToSessionAnchor(context, "zzz.jsonl");
  assert.deepEqual(jumped, [0]);
});

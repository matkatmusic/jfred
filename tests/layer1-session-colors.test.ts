// L9 redesign: each session gets one stable color, in order of first appearance.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listSessionColors } from "../webapp/layer1-components/session-column/layer1-session-colors.ts";
import { WireRecordKind, type WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

function buildAnnotation(id: string, sessionId: string): WireAnnotation {
  return {
    id,
    kind: WireRecordKind.user,
    instant: "2026-06-01T09:00:00.000Z",
    label: id,
    sessionId,
    sessionTitle: sessionId,
    sessionFile: `/x/${sessionId}.jsonl`,
    line: 1000,
  };
}

const ANNOTATIONS = [
  buildAnnotation("r1", "s-b"),
  buildAnnotation("r2", "s-a"),
  buildAnnotation("r3", "s-b"),
  buildAnnotation("r4", "s-d"),
  buildAnnotation("r5", "s-c"),
];

test("test_colors_follow_first_appearance_order", () => {
  // Scenario: keys come out in the order the sessions first show up.
  assert.deepEqual([...listSessionColors(ANNOTATIONS).keys()], ["s-b", "s-a", "s-d", "s-c"]);
});

test("test_same_session_id_has_one_color", () => {
  // Scenario: three records over two sessions give two map entries.
  const colors = listSessionColors(ANNOTATIONS.slice(0, 3));
  assert.equal(colors.size, 2);
  assert.ok(colors.get("s-b")?.startsWith("hsl("));
});

test("test_four_sessions_have_four_distinct_colors", () => {
  // Scenario: the fixture's four sessions are never confused.
  assert.equal(new Set(listSessionColors(ANNOTATIONS).values()).size, 4);
});

test("test_second_call_gives_the_same_colors", () => {
  // Scenario: reload gives the same colors.
  assert.deepEqual([...listSessionColors(ANNOTATIONS)], [...listSessionColors(ANNOTATIONS)]);
});

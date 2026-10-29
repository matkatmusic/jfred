// Session colors and header summary text for one timeline render pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

function createNode(sessionId: string | undefined, stepNumber: number | undefined, paths: string[]): never {
  const fileChanges = paths.map((path) => ({ path }));
  return { sessionId, stepNumber, fileChanges } as never;
}

test("test_buildSessionColors_gives_each_session_one_lane_color", async () => {
  initWebappDom();
  const { buildSessionColors } = await import("../webapp/views/timeline-view-setup.ts");
  const { SESSION_LANE_VARIABLES } = await import("../webapp/views/timeline-sessions.ts");
  const nodes = [createNode("a", 1, []), createNode(undefined, 2, []), createNode("b", 3, []), createNode("a", 4, [])];
  const colors = buildSessionColors(nodes);
  assert.deepEqual([...colors.keys()], ["a", "b"]);
  assert.equal(colors.get("a"), `var(${SESSION_LANE_VARIABLES[0]})`);
  assert.equal(colors.get("b"), `var(${SESSION_LANE_VARIABLES[1]})`);
});

test("test_formatTimelineSummary_counts_steps_and_distinct_files", async () => {
  initWebappDom();
  const { formatTimelineSummary } = await import("../webapp/views/timeline-view-setup.ts");
  const nodes = [createNode("a", 1, ["x.ts", "y.ts"]), createNode("a", undefined, []), createNode("a", 2, ["x.ts"])];
  assert.equal(formatTimelineSummary(nodes, 1), "1 session · 2 steps · 2 files");
  assert.equal(formatTimelineSummary(nodes, 2), "2 sessions · 2 steps · 2 files");
});

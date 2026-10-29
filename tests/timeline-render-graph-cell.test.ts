// buildGraphCell: lane-2 rail only inside lane runs, hollow dots for commit and session-end rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";

test("test_graph_cell_adds_lane2_rail_and_fork_on_run_start", async () => {
    initWebappDom();
    const { buildGraphCell } = await import("../webapp/views/timeline-render-graph-cell.ts");
    const { AGENT_TURN_NODE_KIND } = await import("../webapp/views/timeline-types.ts");
    const runs = [{ startIndex: 2, endIndex: 4 }];
    const outside = buildGraphCell(AGENT_TURN_NODE_KIND, 0, runs, "red");
    assert.equal(outside.querySelector(".g-l2"), null);
    const first = buildGraphCell(AGENT_TURN_NODE_KIND, 2, runs, "red");
    assert.notEqual(first.querySelector(".g-rail.g-l2.g-start"), null);
    assert.notEqual(first.querySelector(".g-fork"), null);
    const last = buildGraphCell(AGENT_TURN_NODE_KIND, 4, runs, "red");
    assert.notEqual(last.querySelector(".g-rail.g-l2.g-end"), null);
    assert.equal(last.querySelector(".g-fork"), null);
});

test("test_graph_cell_commit_dot_is_hollow", async () => {
    initWebappDom();
    const { buildGraphCell } = await import("../webapp/views/timeline-render-graph-cell.ts");
    const { COMMIT_NODE_KIND, AGENT_TURN_NODE_KIND } = await import("../webapp/views/timeline-types.ts");
    const commit = buildGraphCell(COMMIT_NODE_KIND, 0, [], "red");
    assert.notEqual(commit.querySelector(".g-dot.g-hollow"), null);
    const turn = buildGraphCell(AGENT_TURN_NODE_KIND, 0, [], "red");
    assert.equal(turn.querySelector(".g-hollow"), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { initWebappDom } from "./webapp-dom-test-helpers.ts";
import { AGENT_TURN_NODE_KIND, type TimelineNode } from "../webapp/views/timeline-types.ts";

test("test_renderDetailsMessageMode_lists_no_files_for_a_node_without_file_changes", async () => {
    initWebappDom();
    const { renderDetailsMessageMode } = await import("../webapp/views/details.ts");
    const node: TimelineNode = { kind: AGENT_TURN_NODE_KIND, when: "2026-07-01T10:20:30Z", sessionId: "abc12345", text: "hi", snapshots: [], gitOperations: [] };
    const context = { project: "p", document: { filesTouched: [] }, nodes: [node], openNodeInspector: () => {}, selectTimelineRow: () => {}, openRecordForChangeId: () => {}, fetchRangePatch: async () => "" };
    renderDetailsMessageMode(node, 0, context as never);
    assert.equal(document.getElementById("details-left")!.querySelector(".dempty")!.textContent, "No files touched");
});

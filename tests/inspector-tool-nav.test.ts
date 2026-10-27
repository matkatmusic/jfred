// Tests for webapp/inspector-tool-nav.ts: hook and result line targets for a tool_use record.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findToolNavigationTargets } from "../webapp/inspector-tool-nav.ts";

// A minimal transcript: a Bash tool_use, its hook attachment twice, and the linked tool_result.
const TOOL_FLOW_RAW_LINES = [
    JSON.stringify({ type: "assistant", uuid: "record-59", message: { content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: {} }] } }),
    JSON.stringify({ type: "attachment", uuid: "record-60", attachment: { type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "toolu_x" } }),
    JSON.stringify({ type: "attachment", uuid: "record-61", attachment: { type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "toolu_x" } }),
    JSON.stringify({ type: "user", uuid: "record-62", sourceToolAssistantUUID: "record-59", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x" }] } }),
];

test("test_findToolNavigationTargets_resolves_hook_and_result_lines", () => {
    // Scenario: a tool_use record offers jumps to its first hook line and its tool-result line.
    const targets = findToolNavigationTargets(TOOL_FLOW_RAW_LINES, JSON.parse(TOOL_FLOW_RAW_LINES[0]!));
    assert.ok(targets !== undefined);
    // the hook jump lands on the first hook line, not the duplicate after it.
    assert.equal(targets!.hookLine, 1);
    // the result jump lands on the sourceToolAssistantUUID line.
    assert.equal(targets!.resultLine, 3);
});

test("test_findToolNavigationTargets_ignores_non_tool_records", () => {
    // Scenario: records that call no tool offer no tool-flow navigation.
    const targets = findToolNavigationTargets(TOOL_FLOW_RAW_LINES, JSON.parse(TOOL_FLOW_RAW_LINES[3]!));
    assert.equal(targets, undefined);
});

test("test_findToolNavigationTargets_falls_back_to_tool_use_id_for_results", () => {
    // Scenario: an older result record without sourceToolAssistantUUID is found by its tool_use_id.
    const rawLines = [...TOOL_FLOW_RAW_LINES];
    rawLines[3] = JSON.stringify({ type: "user", uuid: "record-62", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x" }] } });
    const targets = findToolNavigationTargets(rawLines, JSON.parse(rawLines[0]!));
    assert.equal(targets!.resultLine, 3);
});

// findTimelineNodeIndexForRawLine (timeline-labels.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findTimelineNodeIndexForRawLine, formatRowTimestamp } from "../webapp/views/timeline-labels.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import { readFileSync } from "node:fs";
import {
    s85Document,
    s2Document,
    S39_SEED_JSONL_PATH,
    s39SeedDocument,
} from "./timeline-test-helpers.ts";

// Raw lines split exactly like webapp/app.ts fetchRawRecords (non-blank lines only).

const s39SeedRawLines = readFileSync(S39_SEED_JSONL_PATH.toString(), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);

test("test_findTimelineNodeIndexForRawLine_finds_step_owning_line", () => {
    // A line carrying a changeId verbatim resolves to the agent turn OWNING that snapshot.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const agentNodeIndex = nodes.findIndex((node: { kind: string; snapshots?: { length: number } }) =>
        node.kind === AGENT_TURN_NODE_KIND && node.snapshots!.length > 0);
    assert.ok(agentNodeIndex >= 0);
    const changeId = nodes[agentNodeIndex]!.snapshots![0]!.changeIds[0];
    assert.ok(changeId !== undefined);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, `{"id":"${changeId}"}`);
    assert.equal(nodeIndex, agentNodeIndex);
});

test("test_findTimelineNodeIndexForRawLine_prefers_changeId_over_message_uuid", () => {
    // A snapshot line also carries a prompt uuid; the file-change id wins since that's what the line describes.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const agentNodeIndex = nodes.findIndex((node: { kind: string; snapshots?: { length: number } }) =>
        node.kind === AGENT_TURN_NODE_KIND && node.snapshots!.length > 0);
    const userNode = nodes.find((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND);
    const changeId = nodes[agentNodeIndex]!.snapshots![0]!.changeIds[0];
    const nodeIndex = findTimelineNodeIndexForRawLine(
        nodes,
        `{"messageId":"${userNode!.uuid}","changeId":"${changeId}"}`,
    );
    assert.equal(nodeIndex, agentNodeIndex);
});

test("test_findTimelineNodeIndexForRawLine_matches_user_turn_by_message_uuid", () => {
    // An /at/<line> anchor on a prompt line must land on the prompt's own step.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const userNodeIndex = nodes.findIndex((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND);
    assert.ok(userNodeIndex >= 0);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, `{"uuid":"${nodes[userNodeIndex]!.uuid}"}`);
    assert.equal(nodeIndex, userNodeIndex);
});

test("test_findTimelineNodeIndexForRawLine_returns_minus_one_when_no_step_matches", () => {
    // s85's timeline contains commit nodes, which the scan must skip rather than match.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, '{"type":"summary","message":"hello"}');
    assert.equal(nodeIndex, -1);
});

test("test_find_node_for_raw_line_maps_hook_attachment_to_its_tool_call", () => {
    // A hook-attachment line must resolve to its tool call's row, not the earlier prompt step.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[48]!);
    assert.ok(nodeIndex >= 0);
    assert.equal(nodes[nodeIndex]!.kind, TOOL_CALL_NODE_KIND);
    assert.ok(nodes[nodeIndex]!.summary!.startsWith("mkdir -p"));
});

test("test_find_node_for_raw_line_keeps_selection_on_snapshot_lines", () => {
    // Reported bug: lines 49/50 carry the Step-3 prompt's uuid as snapshot.messageId, and the bare-substring match wrongly selected Step 3.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    assert.equal(findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[49]!), -1);
    assert.equal(findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[50]!), -1);
});

test("test_find_node_for_raw_line_matches_agent_turns_own_message_line", () => {
    // Stepping onto a reply's own record line must select that reply's step.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[31]!);
    assert.ok(nodeIndex >= 0);
    assert.equal(nodes[nodeIndex]!.kind, AGENT_TURN_NODE_KIND);
    assert.ok(nodes[nodeIndex]!.text!.startsWith("Setting up the repo"));
});

test("test_user_turn_uuid_match_requires_uuid_key_form", () => {
    // A user turn owns a line only when the line IS its record, not when it merely references it.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const userNodeIndex = nodes.findIndex((node) => node.kind === USER_TURN_NODE_KIND);
    const userUuid = nodes[userNodeIndex]!.uuid;
    assert.equal(findTimelineNodeIndexForRawLine(nodes, `{"messageId":"${userUuid}"}`), -1);
    assert.equal(findTimelineNodeIndexForRawLine(nodes, `{"uuid":"${userUuid}"}`), userNodeIndex);
});

test("test_row_timestamp_formats_empty_and_invalid_as_blank", () => {
    // Task 160: summary lines carry no timestamp, so blank beats "Invalid Date".
    assert.equal(formatRowTimestamp(""), "");
    assert.equal(formatRowTimestamp("not-a-date"), "");
    assert.equal(formatRowTimestamp("2026-07-21T12:00:00Z"), new Date("2026-07-21T12:00:00Z").toLocaleString());
});

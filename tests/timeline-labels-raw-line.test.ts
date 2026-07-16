// findTimelineNodeIndexForRawLine (timeline-labels.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findTimelineNodeIndexForRawLine } from "../webapp/views/timeline-labels.ts";
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
    // Scenario: a raw JSONL line carries a snapshot's changeId verbatim (the same substring
    // convention findLineForChangeId uses in the other direction) — it resolves to the agent
    // turn OWNING that snapshot.
    // Steps:
    // build s2's turn timeline; take the first agent turn that owns a snapshot.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const agentNodeIndex = nodes.findIndex((node: { kind: string; snapshots?: { length: number } }) =>
        node.kind === AGENT_TURN_NODE_KIND && node.snapshots!.length > 0);
    assert.ok(agentNodeIndex >= 0);
    const changeId = nodes[agentNodeIndex]!.snapshots![0]!.changeIds[0];
    assert.ok(changeId !== undefined);
    // craft a raw line embedding that changeId and look up its owning node.
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, `{"id":"${changeId}"}`);
    // the lookup lands on the owning agent turn.
    assert.equal(nodeIndex, agentNodeIndex);
});

test("test_findTimelineNodeIndexForRawLine_prefers_changeId_over_message_uuid", () => {
    // Scenario: a file-history-snapshot line embeds BOTH a changeId and the uuid of the prompt
    // that triggered it (verified against s43 line 110) — the line is about the file change, so
    // the owning AGENT turn must win over the prompt's uuid match.
    // Steps:
    // build s2's turn timeline; take an agent turn's changeId and any user turn's uuid.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const agentNodeIndex = nodes.findIndex((node: { kind: string; snapshots?: { length: number } }) =>
        node.kind === AGENT_TURN_NODE_KIND && node.snapshots!.length > 0);
    const userNode = nodes.find((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND);
    const changeId = nodes[agentNodeIndex]!.snapshots![0]!.changeIds[0];
    // craft a raw line embedding BOTH identifiers and look it up.
    const nodeIndex = findTimelineNodeIndexForRawLine(
        nodes,
        `{"messageId":"${userNode!.uuid}","changeId":"${changeId}"}`,
    );
    // the agent turn owning the changeId wins.
    assert.equal(nodeIndex, agentNodeIndex);
});

test("test_findTimelineNodeIndexForRawLine_matches_user_turn_by_message_uuid", () => {
    // Scenario: an /at/<line> anchor on a prompt line must land on the prompt's own step — a raw
    // line containing a user turn's message uuid resolves to that user-turn node.
    // Steps:
    // build s2's turn timeline; take its first user turn.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const userNodeIndex = nodes.findIndex((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND);
    assert.ok(userNodeIndex >= 0);
    // craft a raw line embedding that message's uuid and look it up.
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, `{"uuid":"${nodes[userNodeIndex]!.uuid}"}`);
    // the lookup lands on the prompt's node.
    assert.equal(nodeIndex, userNodeIndex);
});

test("test_findTimelineNodeIndexForRawLine_returns_minus_one_when_no_step_matches", () => {
    // Scenario: a raw line containing no changeId and no message uuid owns no step; commit and
    // session-end nodes are never matched (s85's timeline contains commit nodes the scan must skip).
    // Steps:
    // build s85's turn timeline and look up an anchor-free line.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, '{"type":"summary","message":"hello"}');
    // no node owns the line.
    assert.equal(nodeIndex, -1);
});

test("test_find_node_for_raw_line_maps_hook_attachment_to_its_tool_call", () => {
    // Scenario: raw line 48 is a PostToolUse hook attachment carrying the mkdir toolUseID — the
    // inspector's Prev/Next sync must land on the mkdir tool row, never an earlier prompt step.
    // Steps:
    // build the seed-session timeline and look up raw line 48.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[48]!);
    // the owning node is the mkdir tool-call row.
    assert.ok(nodeIndex >= 0);
    assert.equal(nodes[nodeIndex]!.kind, TOOL_CALL_NODE_KIND);
    assert.ok(nodes[nodeIndex]!.summary!.startsWith("mkdir -p"));
});

test("test_find_node_for_raw_line_keeps_selection_on_snapshot_lines", () => {
    // Scenario (the reported bug): raw lines 49/50 are file-history-snapshot records whose inner
    // snapshot.messageId is the Step-3 PROMPT's uuid — the bare-substring uuid match selected
    // Step 3. Snapshot lines owned by no node must return -1 (selection unchanged).
    // Steps:
    // build the seed-session timeline and look up both snapshot lines.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    // neither snapshot line resolves to any node (their changeIds are the Write toolu ids, which
    // do not appear in the snapshot lines; the prompt uuid appears only as "messageId").
    assert.equal(findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[49]!), -1);
    assert.equal(findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[50]!), -1);
});

test("test_find_node_for_raw_line_matches_agent_turns_own_message_line", () => {
    // Scenario: stepping the inspector onto a reply's own record line (raw line 31, the
    // "Setting up the repo…" text record) must select that reply's step.
    // Steps:
    // build the seed-session timeline and look up raw line 31.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const nodeIndex = findTimelineNodeIndexForRawLine(nodes, s39SeedRawLines[31]!);
    // the owning node is the reply agent turn.
    assert.ok(nodeIndex >= 0);
    assert.equal(nodes[nodeIndex]!.kind, AGENT_TURN_NODE_KIND);
    assert.ok(nodes[nodeIndex]!.text!.startsWith("Setting up the repo"));
});

test("test_user_turn_uuid_match_requires_uuid_key_form", () => {
    // Scenario: a user turn owns a raw line only when the line IS its record — the uuid must
    // appear as a "uuid":"…" field, not merely referenced (snapshot messageId, parentUuid).
    // Steps:
    // build s2's turn timeline and take its first user turn.
    const { nodes } = buildTurnTimelineViewModel(s2Document);
    const userNodeIndex = nodes.findIndex((node) => node.kind === USER_TURN_NODE_KIND);
    const userUuid = nodes[userNodeIndex]!.uuid;
    // a line referencing the uuid as a messageId matches nothing.
    assert.equal(findTimelineNodeIndexForRawLine(nodes, `{"messageId":"${userUuid}"}`), -1);
    // the record's own "uuid":"…" form still matches the user turn.
    assert.equal(findTimelineNodeIndexForRawLine(nodes, `{"uuid":"${userUuid}"}`), userNodeIndex);
});

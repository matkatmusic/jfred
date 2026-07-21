// computeRowSummaryText and session short labels (timeline-labels.ts) — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeRowSummaryText,
    computeSessionShortLabel,
} from "../webapp/views/timeline-labels.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
    USER_TURN_NODE_KIND,
    type CommitNode,
} from "../webapp/views/timeline-types.ts";
import { RecordType } from "../src/structures/vocabulary.ts";

test("test_computeRowSummaryText_uses_first_text_line", () => {
    // Scenario: a user or agent turn's one-line row text is the FIRST line of its message text
    // (the collapsed fork-style row shows one line; the bubble shows the rest).
    // Steps:
    // build a minimal document with a multi-line prompt and a multi-line reply.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "first line of the prompt\nsecond line",
        }, {
            uuid: "reply-1",
            role: RecordType.assistant,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:10.000Z",
            text: "first line of the reply\nrest of the reply",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the user turn's summary is its first text line only.
    const userTurn = nodes.find((node: { kind: string }) => node.kind === USER_TURN_NODE_KIND)!;
    assert.equal(computeRowSummaryText(userTurn), "first line of the prompt");
    // assert the agent turn's summary is its first text line only.
    const agentTurn = nodes.find((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND)!;
    assert.equal(computeRowSummaryText(agentTurn), "first line of the reply");
});

test("test_computeRowSummaryText_formats_tool_calls_as_name_parens_summary", () => {
    // Scenario: a tool-call row reads like the mockup's `Bash(npx tsc --noEmit)` — tool name,
    // parens, the truncated one-line summary.
    // Steps:
    // build a minimal document with a short and a long Bash tool call.
    const longCommand = "x".repeat(120);
    const document = {
        messages: [],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
        toolCalls: [{
            toolName: "Bash",
            summary: "npx tsc --noEmit",
            timestamp: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
            uuid: "call-1",
            toolUseId: "toolu_call1",
        }, {
            toolName: "Bash",
            summary: longCommand,
            timestamp: "2026-01-01T00:00:10.000Z",
            sessionId: "session-a",
            uuid: "call-2",
            toolUseId: "toolu_call2",
        }],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    const toolCalls = nodes.filter((node: { kind: string }) => node.kind === TOOL_CALL_NODE_KIND);
    // assert the short call formats as name(summary).
    assert.equal(computeRowSummaryText(toolCalls[0]!), "Bash(npx tsc --noEmit)");
    // assert the long call's summary is truncated through truncateToolCallSummary.
    assert.equal(computeRowSummaryText(toolCalls[1]!), `Bash(${"x".repeat(50)}…)`);
});

test("test_computeRowSummaryText_labels_session_ends", () => {
    // Scenario: a session-end row reads `end of session <short8>` — the session's 8-char label,
    // matching the sidebar and the uuid column.
    // Steps:
    // build a minimal one-prompt document with a realistic session uuid.
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "hello",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the session-end row text names the first 8 chars of the session id.
    const sessionEnd = nodes.find((node: { kind: string }) => node.kind === SESSION_END_NODE_KIND)!;
    assert.equal(computeRowSummaryText(sessionEnd), "end of session 0a1b2c3d");
});

test("test_computeRowSummaryText_falls_back_for_blank_agent_turns", () => {
    // Scenario: a synthetic trailing agent turn has no reply text — its row must read
    // "(tool activity)" instead of rendering blank.
    // Steps:
    // build a document whose only agent turn is synthetic (a snapshot with no later reply).
    const document = {
        messages: [{
            uuid: "prompt-1",
            role: RecordType.user,
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "write a file",
        }],
        steps: [{
            index: 1,
            when: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
            changeIds: ["change-1"],
            changedPaths: ["notes.txt"],
            files: {},
        }],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
    };
    const { nodes } = buildTurnTimelineViewModel(document);
    // assert the blank synthetic turn falls back to the tool-activity label.
    const agentTurn = nodes.find((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND)!;
    assert.equal(agentTurn.text, "");
    assert.equal(computeRowSummaryText(agentTurn), "(tool activity)");
});

test("test_computeSessionShortLabel_takes_first_eight_chars", () => {
    // Scenario: session ids everywhere in the fork layout (uuid column, sidebar, session-end
    // rows) shorten to their first 8 characters.
    // Steps:
    // assert a full uuid shortens to its first 8 chars.
    assert.equal(computeSessionShortLabel("0a1b2c3d-4e5f-6789-abcd-ef0123456789"), "0a1b2c3d");
    // assert an id shorter than 8 chars passes through whole.
    assert.equal(computeSessionShortLabel("abc"), "abc");
});

test("test_computeRowSummaryText_prefers_commit_node_text", () => {
    // Scenario (task 121): the merged git-derived baseline row is a commit node carrying its
    // baseline summary text — the row text wins over the commit message; a plain commit
    // still shows its message.
    // Steps:
    // a merged baseline commit node returns its baseline text.
    const mergedBaselineCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "2026-01-01T00:05:00.000Z", sessionId: "session-a", detail: "baseline", text: "Files seeded from git base commit abc1234" };
    assert.equal(computeRowSummaryText(mergedBaselineCommit), "Files seeded from git base commit abc1234");
    // the same node without text still returns its commit message.
    const plainCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "2026-01-01T00:05:00.000Z", sessionId: "session-a", detail: "baseline" };
    assert.equal(computeRowSummaryText(plainCommit), "baseline");
});

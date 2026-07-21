// Unit tests for webapp/views/timeline-line-nodes.ts (task 134): the raw-line rows behind the
// timeline's "show every JSONL line" toggle. DOM-free — model only, like timeline-nodes.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_NODE_KIND, deriveLineNodes } from "../webapp/views/timeline-line-nodes.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";

// A minimal document: one prompt turn, one tool call, and three verdict lines — the prompt's
// line (already a turn row), a hook line nobody else shows, and a uuid-less summary line.
function buildLineVerdictDocument() {
    return {
        messages: [{
            uuid: "prompt-1",
            role: "user",
            sessionId: "session-a",
            timestamp: "2026-01-01T00:00:00.000Z",
            text: "hello",
        }],
        steps: [],
        filesTouched: [],
        rewoundFilesTouched: [],
        commitMarkers: [],
        toolCalls: [{
            toolName: "Bash",
            summary: "ls",
            timestamp: "2026-01-01T00:00:05.000Z",
            sessionId: "session-a",
            uuid: "tool-1",
            toolUseId: "toolu-1",
        }],
        lineVerdicts: [
            { line: 0, uuid: "prompt-1", type: "user", verdict: "conversation", timestamp: "2026-01-01T00:00:00.000Z", sessionId: "session-a" },
            { line: 1, uuid: "tool-1", type: "assistant", verdict: "conversation", timestamp: "2026-01-01T00:00:05.000Z", sessionId: "session-a" },
            { line: 2, uuid: "hook-1", type: "attachment", verdict: "ignore", timestamp: "2026-01-01T00:00:07.000Z", sessionId: "session-a" },
            { line: 3, type: "summary", verdict: "ignore" },
        ],
    };
}

test("test_derive_line_nodes_emits_one_node_per_unrepresented_verdict", () => {
    // Scenario: only lines NO existing row shows become raw-line nodes.
    // Steps:
    // derive over a document whose verdicts include a turn line, a tool line, a hook line, and
    // a uuid-less summary line.
    const lineNodes = deriveLineNodes(buildLineVerdictDocument());
    // the turn and tool lines are skipped; hook + summary get their own rows.
    assert.deepEqual(lineNodes.map((node) => node.uuid), ["hook-1", undefined]);
    // every emitted node carries the raw-line kind and its "<type> · <verdict>" text.
    assert.ok(lineNodes.every((node) => node.kind === LINE_NODE_KIND));
    assert.equal(lineNodes[0]!.text, "attachment · ignore");
    // when/sessionId surface the wire timestamp and session for sorting and lane tint.
    assert.equal(lineNodes[0]!.when, "2026-01-01T00:00:07.000Z");
    assert.equal(lineNodes[0]!.sessionId, "session-a");
});

test("test_derive_line_nodes_defaults_missing_timestamp_to_empty_when", () => {
    // Scenario: a timestamp-less record (e.g. a summary line) sorts to the top via when="".
    const lineNodes = deriveLineNodes(buildLineVerdictDocument());
    // the uuid-less summary verdict became a node whose when is the empty string.
    assert.equal(lineNodes[1]!.when, "");
    assert.equal(lineNodes[1]!.sessionId, undefined);
});

test("test_view_model_includes_line_nodes_only_when_toggled", () => {
    // Scenario: buildTurnTimelineViewModel emits raw-line rows only when the toggle is on, and
    // never numbers them (step numbers drive picks and range patches).
    // Steps:
    // build the view model with the toggle ON.
    const { nodes } = buildTurnTimelineViewModel(buildLineVerdictDocument(), true);
    const lineNodes = nodes.filter((node) => node.kind === LINE_NODE_KIND);
    // both unrepresented lines are rows, interleaved by their when instants.
    assert.equal(lineNodes.length, 2);
    // raw-line rows carry NO step number.
    assert.ok(lineNodes.every((node) => node.stepNumber === undefined));
    // the hook line (00:00:07) sorts after the tool call (00:00:05).
    const hookIndex = nodes.findIndex((node) => node.uuid === "hook-1");
    const toolIndex = nodes.findIndex((node) => node.uuid === "tool-1");
    assert.ok(hookIndex > toolIndex, "hook line row sorts after the tool row");
    // the default build (toggle off) emits none.
    const { nodes: defaultNodes } = buildTurnTimelineViewModel(buildLineVerdictDocument());
    assert.equal(defaultNodes.filter((node) => node.kind === LINE_NODE_KIND).length, 0);
});

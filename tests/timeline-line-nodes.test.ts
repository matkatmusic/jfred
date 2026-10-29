// Unit tests for timeline-line-nodes.ts (task 134): raw-line rows behind the "show every JSONL line" toggle, DOM-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LINE_NODE_KIND, computeLineNodes } from "../webapp/views/timeline-line-nodes.ts";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";

// A minimal document: one prompt turn, one tool call, and verdict lines for prompt, hook, and summary.
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
    // Scenario: only lines that no existing row shows become raw-line nodes.
    const lineNodes = computeLineNodes(buildLineVerdictDocument());
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
    const lineNodes = computeLineNodes(buildLineVerdictDocument());
    // the uuid-less summary verdict became a node whose when is the empty string.
    assert.equal(lineNodes[1]!.when, "");
    assert.equal(lineNodes[1]!.sessionId, undefined);
});

test("test_view_model_includes_line_nodes_only_when_toggled", () => {
    // Scenario: raw-line rows appear only with the toggle on, and never get step numbers.
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

test("test_derive_line_nodes_carries_source_coordinates", () => {
    // Scenario (task 160): a verdict source gives file basename and lineNumber - 1; no source gives undefined.
    const document = buildLineVerdictDocument();
    document.lineVerdicts[2] = {
        ...document.lineVerdicts[2]!,
        source: { filePath: "/home/user/.claude/projects/p/session-a.jsonl", lineNumber: 3 },
    } as unknown as (typeof document.lineVerdicts)[number];
    const nodes = computeLineNodes(document as never);
    // the hook line (verdict index 2) carries basename + 0-based line.
    const hookNode = nodes.find((node) => node.uuid === "hook-1")!;
    assert.equal(hookNode.sourceJsonlName, "session-a.jsonl");
    assert.equal(hookNode.sourceLineIndex, 2);
    // the source-less summary line yields undefined coordinates.
    const summaryNode = nodes.find((node) => node.uuid === undefined)!;
    assert.equal(summaryNode.sourceJsonlName, undefined);
    assert.equal(summaryNode.sourceLineIndex, undefined);
});

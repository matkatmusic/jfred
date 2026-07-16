// buildTurnTimelineViewModel: standalone tool-call rows — wire-shape inputs; shared fixtures in timeline-test-helpers.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTurnTimelineViewModel } from "../webapp/views/timeline-nodes.ts";
import {
    AGENT_TURN_NODE_KIND,
    SESSION_END_NODE_KIND,
    TOOL_CALL_NODE_KIND,
} from "../webapp/views/timeline-types.ts";
import {
    s85Document,
    s39SeedDocument,
} from "./timeline-test-helpers.ts";

// item 55 (adjusted 2026-07-09): the original test below pinned the RETIRED design — git rows
// rendered inside agent-turn bubbles via attachGitOperationsToAgentTurns. Item 55 made every
// git command a standalone un-bubbled tool-call row instead; the replacement test follows.
// test("test_agent_turns_own_every_git_operation_of_their_session", () => {
//     // Scenario: each of s85's five recorded git operations renders inside exactly one agent turn
//     // of its own session — the timeline's `* git <kind> <detail> *` rows.
//     // Steps:
//     // build s85's turn timeline.
//     const { nodes } = buildTurnTimelineViewModel(s85Document);
//     const agentNodes = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
//     // assert the turns collectively own the document's operations, in document order.
//     const owned = agentNodes.flatMap((node) => node.gitOperations!);
//     assert.deepEqual(
//         owned.map((operation: { command: string }) => operation.command),
//         s85Document.gitOperations.map((operation: { command: string }) => operation.command),
//     );
//     // assert no operation crossed into another session's turn.
//     for (const node of agentNodes) {
//         for (const operation of node.gitOperations!) {
//             assert.equal(operation.sessionId, node.sessionId);
//         }
//     }
// });

test("test_git_operations_render_as_standalone_tool_call_rows_not_turn_rows", () => {
    // Scenario (item 55): git commands are un-bubbled tool-call rows between the conversation
    // bubbles, never rows inside agent-turn bubbles. Each of s85's five recorded git operations
    // is a Bash tool_use, so a tool-call node shares its exact instant and session.
    // Steps:
    // build s85's turn timeline.
    const { nodes } = buildTurnTimelineViewModel(s85Document);
    // assert NO agent turn owns git operations anymore (the retired attachment stays retired).
    const agentNodes = nodes.filter((node: { kind: string }) => node.kind === AGENT_TURN_NODE_KIND);
    for (const node of agentNodes) {
        assert.deepEqual(node.gitOperations ?? [], []);
    }
    // assert every recorded git operation has a tool-call row at its instant, in its session.
    const toolCallNodes = nodes.filter((node: { kind: string }) => node.kind === TOOL_CALL_NODE_KIND);
    for (const operation of s85Document.gitOperations) {
        const row = toolCallNodes.find(
            (node: { when: string; sessionId?: string }) =>
                node.when === operation.timestamp && node.sessionId === operation.sessionId,
        );
        assert.ok(row !== undefined, `a tool-call row carries ${operation.command}`);
    }
});

// ─── tool-call rows (item 55): every non-file-edit tool call is an un-bubbled timeline node ─────

test("test_document_ships_tool_calls_on_the_wire", () => {
    // Scenario: the wire document carries toolCalls[] so the timeline can render tool rows.
    // Steps:
    // assert the seed session ships its six calls (git init, ls, rtk ls, mkdir, git add,
    // rtk git add) with string-serialized fields.
    assert.ok(s39SeedDocument.toolCalls.length >= 6);
    for (const call of s39SeedDocument.toolCalls) {
        assert.equal(typeof call.uuid, "string");
        assert.equal(typeof call.toolUseId, "string");
        assert.equal(typeof call.timestamp, "string");
        assert.equal(typeof call.summary, "string");
        assert.equal(typeof call.toolName, "string");
    }
});

test("test_tool_call_nodes_sort_between_reply_and_files_bubble", () => {
    // Scenario: s39's reply "Setting up the repo…" precedes its tool calls; the four commands
    // before the Writes must render as rows between the reply bubble and the files bubble, the
    // post-Write git add rows between the files bubble and the session end.
    // Steps:
    // build the seed-session timeline.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    const findToolRow = (prefix: string) => nodes.findIndex((node) =>
        node.kind === TOOL_CALL_NODE_KIND && node.summary!.startsWith(prefix));
    const replyIndex = nodes.findIndex((node) =>
        node.kind === AGENT_TURN_NODE_KIND && (node.text ?? "").startsWith("Setting up the repo"));
    const filesBubbleIndex = nodes.findIndex((node) =>
        node.kind === AGENT_TURN_NODE_KIND && node.text === "" && (node.fileChanges ?? []).length === 2);
    const sessionEndIndex = nodes.findIndex((node) => node.kind === SESSION_END_NODE_KIND);
    // the pre-Write commands sit between the reply bubble and the files bubble, in run order.
    assert.ok(replyIndex >= 0 && filesBubbleIndex >= 0 && sessionEndIndex >= 0);
    assert.ok(replyIndex < findToolRow("git init"));
    assert.ok(findToolRow("git init") < findToolRow("ls /private/"));
    assert.ok(findToolRow("ls /private/") < findToolRow("rtk ls "));
    assert.ok(findToolRow("rtk ls ") < findToolRow("mkdir -p"));
    assert.ok(findToolRow("mkdir -p") < filesBubbleIndex);
    // the post-Write git add (and its rtk rewrite) sit after the files bubble, BEFORE the
    // session end — the end node closes the session after everything in it.
    assert.ok(filesBubbleIndex < findToolRow("git add"));
    assert.ok(findToolRow("git add") < findToolRow("rtk git add"));
    assert.ok(findToolRow("rtk git add") < sessionEndIndex);
});

test("test_tool_call_nodes_are_never_numbered", () => {
    // Scenario: tool rows are not steps — numbering must skip them (like commit nodes), so the
    // seed session keeps its six numbered steps ending with the session end.
    // Steps:
    // build the seed-session timeline.
    const { nodes } = buildTurnTimelineViewModel(s39SeedDocument);
    // assert every tool-call node is unnumbered.
    for (const node of nodes.filter((entry) => entry.kind === TOOL_CALL_NODE_KIND)) {
        assert.equal(node.stepNumber, undefined);
    }
    // assert the session-end step keeps step number 6 (steps 1-5 are the conversation turns).
    const sessionEnd = nodes.find((node) => node.kind === SESSION_END_NODE_KIND);
    assert.equal(sessionEnd!.stepNumber, 6);
});

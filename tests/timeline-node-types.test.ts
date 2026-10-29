import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, SESSION_END_NODE_KIND, TOOL_CALL_NODE_KIND } from "../webapp/views/timeline-types.ts";
import type { CommitNode, FileChange, SessionEndNode, TimelineNode, ToolCallNode, TurnNode } from "../webapp/views/timeline-node-types.ts";

test("one typed value of each node type joins the TimelineNode union", () => {
  const when = "2026-01-01T00:00:00Z";
  const chip: FileChange = { path: "a.ts", displayPath: "a.ts", eventKind: "edit", renamedFrom: undefined, isFirstRevision: true, changeId: "c1", when };
  const turn: TurnNode = { kind: AGENT_TURN_NODE_KIND, when, sessionId: "s1", text: "hi", snapshots: [], gitOperations: [], fileChanges: [chip] };
  const sessionEnd: SessionEndNode = { kind: SESSION_END_NODE_KIND, when, sessionId: "s1", snapshots: [] };
  const commit: CommitNode = { kind: COMMIT_NODE_KIND, when, sessionId: "s1" };
  const toolCall: ToolCallNode = { kind: TOOL_CALL_NODE_KIND, when, sessionId: "s1", uuid: "u1", toolName: "Bash", summary: "ls", toolUseId: "t1" };
  const nodes: TimelineNode[] = [turn, sessionEnd, commit, toolCall];
  assert.deepEqual(nodes.map((node) => node.kind), [AGENT_TURN_NODE_KIND, SESSION_END_NODE_KIND, COMMIT_NODE_KIND, TOOL_CALL_NODE_KIND]);
});

// buildCommitNodes / buildToolCallNodes: commit fallback to commitMarkers, and failed-git stamping on tool-call rows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommitNodes, buildToolCallNodes } from "../webapp/views/timeline-node-derive.ts";
import { COMMIT_NODE_KIND, COMMIT_OPERATION_KIND } from "../webapp/views/timeline-types.ts";
import type { WireTimelineDocument } from "../webapp/views/timeline-wire-types.ts";

function buildWireDocument(overrides: Partial<WireTimelineDocument>): WireTimelineDocument {
  return { filesTouched: [], rewoundFilesTouched: [], messages: [], steps: [], commitMarkers: [], ...overrides };
}

test("test_buildCommitNodes_falls_back_to_commitMarkers_without_gitOperations", () => {
  const document = buildWireDocument({ commitMarkers: [{ timestamp: "2026-07-01T10:00:00Z", sessionId: "s1" }] });
  const nodes = buildCommitNodes(document);
  assert.deepEqual(nodes, [{ kind: COMMIT_NODE_KIND, when: "2026-07-01T10:00:00Z", sessionId: "s1" }]);
});

test("test_buildCommitNodes_keeps_only_commit_operations", () => {
  const document = buildWireDocument({
    gitOperations: [
      { kind: COMMIT_OPERATION_KIND, detail: "msg", command: "git commit", timestamp: "t1", sessionId: "s1", resultHash: "abc", isError: true },
      { kind: "push", detail: "", command: "git push", timestamp: "t2" },
    ],
  });
  const nodes = buildCommitNodes(document);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.detail, "msg");
  assert.equal(nodes[0]!.isError, true);
});

test("test_buildToolCallNodes_stamps_isError_only_for_failed_git_uuids", () => {
  const document = buildWireDocument({
    gitOperations: [{ kind: "push", detail: "", command: "git push", timestamp: "t1", uuid: "u1", isError: true }],
    toolCalls: [
      { toolName: "Bash", summary: "git push", timestamp: "t1", uuid: "u1", toolUseId: "toolu_1" },
      { toolName: "Bash", summary: "ls", timestamp: "t2", uuid: "u2", toolUseId: "toolu_2" },
    ],
  });
  const nodes = buildToolCallNodes(document);
  assert.equal(nodes[0]!.isError, true);
  assert.equal(nodes[1]!.isError, undefined);
});

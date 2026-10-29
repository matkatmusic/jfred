import { test } from "node:test";
import assert from "node:assert/strict";
import type { WireFileHistory, WireGitOperation, WireMessage, WireScriptRun, WireStepSnapshot, WireTimelineDocument, WireToolCall } from "../webapp/views/timeline-wire-types.ts";

test("one typed value of each main wire type builds a document", () => {
  const history: WireFileHistory = { target: "a.ts", revisions: [{ kind: "edit", changeId: "c1", timestamp: "2026-01-01T00:00:00Z" }] };
  const message: WireMessage = { role: "user", timestamp: "2026-01-01T00:00:00Z", uuid: "u1", text: "hi" };
  const step: WireStepSnapshot = { index: 1, when: "2026-01-01T00:00:00Z", changeIds: ["c1"], changedPaths: ["a.ts"] };
  const gitOperation: WireGitOperation = { kind: "commit", detail: "d", command: "git commit", timestamp: "2026-01-01T00:00:00Z" };
  const toolCall: WireToolCall = { toolName: "Bash", summary: "ls", timestamp: "2026-01-01T00:00:00Z", uuid: "u2", toolUseId: "t1" };
  const scriptRun: WireScriptRun = { timestamp: "2026-01-01T00:00:00Z", code: "x", changedPaths: [] };
  const document: WireTimelineDocument = {
    filesTouched: [history],
    rewoundFilesTouched: [],
    messages: [message],
    steps: [step],
    gitOperations: [gitOperation],
    commitMarkers: [],
    toolCalls: [toolCall],
    scriptRuns: [scriptRun],
  };
  assert.equal(document.filesTouched[0]?.revisions[0]?.changeId, "c1");
  assert.equal(document.toolCalls?.[0]?.toolUseId, "t1");
});

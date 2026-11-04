// Per-file test for webapp/layer1-wire-script-results.ts: the run-outcome, stream-kind and need-state spellings, and the result and needs shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WireNeedState,
  WireRunOutcome,
  WireRunStreamKind,
  type WireScriptNeedsReply,
  type WireScriptResult,
} from "../webapp/layer1-wire-script-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";

test("test_WireRunOutcome_lists_the_exact_members", () => {
  // Verify: the four run outcomes keep their wire spelling.
  assert.deepEqual(WireRunOutcome, {
    replayed: "replayed",
    originalFailed: "original-failed",
    replayFailed: "replay-failed",
    notReplayed: "not-replayed",
  });
});

test("test_WireRunStreamKind_lists_the_exact_members", () => {
  // Verify: only output and result are new; progress and error keep their existing spellings elsewhere.
  assert.deepEqual(WireRunStreamKind, { output: "script-output", result: "script-result" });
});

test("test_WireNeedState_lists_the_exact_members", () => {
  // Verify: the two server-known need states keep their wire spelling.
  assert.deepEqual(WireNeedState, { unreplayed: "unreplayed", replayFailed: "replay-failed" });
});

test("test_WireScriptResult_accepts_with_and_without_optional_fields", () => {
  // Verify: a replayed result with every optional field, and a not-replayed result with none, both type-check.
  const full: WireScriptResult = {
    kind: WireRunStreamKind.result,
    toolUseId: "toolu_1",
    outcome: WireRunOutcome.replayed,
    reason: "ok",
    confidence: WireConfidence.verified,
    files: [{ path: "a.txt", confidence: WireConfidence.verified }],
    stdout: "out",
    stderr: "",
    exitCode: 0,
    timedOut: false,
    isOutputSaved: true,
  };
  const bare: WireScriptResult = {
    kind: WireRunStreamKind.result,
    toolUseId: "toolu_2",
    outcome: WireRunOutcome.notReplayed,
    files: [],
    stdout: "",
    stderr: "",
    timedOut: false,
    isOutputSaved: false,
  };
  assert.equal(full.files.length, 1);
  assert.equal(bare.confidence, undefined);
});

test("test_WireScriptNeedsReply_accepts_empty_and_non_empty_needs", () => {
  // Verify: an empty list (the run may start) and a one-entry list both type-check.
  const empty: WireScriptNeedsReply = { toolUseId: "toolu_1", needs: [] };
  const one: WireScriptNeedsReply = {
    toolUseId: "toolu_1",
    needs: [
      {
        toolUseId: "toolu_0",
        sessionFile: "s.jsonl",
        line: 3,
        instant: "2026-11-03T00:00:00.000Z",
        state: WireNeedState.unreplayed,
      },
    ],
  };
  assert.equal(empty.needs.length, 0);
  assert.equal(one.needs[0]?.state, "unreplayed");
});

// task 193: per-session turn-walk bound tests, split from reconstruction_bound.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { trimRecordsAtRevisionTurnEnd } from "../src/reconstruction_bound.ts";
import {
    SESSION_A,
    SESSION_B,
    buildEditRecordPair,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

test("test_bound_uses_owning_sessions_next_prompt_on_interleaved_streams", () => {
    // Scenario: two sessions interleave; the cut is the owning session's next prompt, by wall clock.  DELETEMEthe other session's records in the window stay.  Stream: promptA1 10:00, write alpha 10:01, promptB1 10:03, edit alpha 10:04, write beta 10:05, promptA2 10:08, write gamma 10:09.
    const tree = makeSourceTree("-bound-interleaved");
    const root = join(tree.treeRoot, "workspace");
    const alphaPath = join(root, "alpha_bound.py");
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:01:00.000Z", toolId: "toolu_il_w1", parentUuid: "prompt-a1" },
        alphaPath,
        "line one\n",
    );
    const editAlpha = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:04:00.000Z", toolId: "toolu_il_e1", parentUuid: writeAlpha.lastUuid },
        alphaPath,
        "line one\nline two\n",
        "line one\n",
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
    );
    const writeBeta = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: root, timestamp: "2026-07-23T10:05:00.000Z", toolId: "toolu_il_w2", parentUuid: "prompt-b1" },
        join(root, "beta_bound.py"),
        "beta\n",
    );
    const writeGamma = buildWriteRecordPair(
        { sessionId: SESSION_B, cwd: root, timestamp: "2026-07-23T10:09:00.000Z", toolId: "toolu_il_w3", parentUuid: writeBeta.lastUuid },
        join(root, "gamma_bound.py"),
        "gamma\n",
    );
    const records = writeTranscriptFixture(tree.projectDir, "interleaved.jsonl", [
        buildPromptRecord("prompt-a1", null, "2026-07-23T10:00:00.000Z", root),
        ...writeAlpha.records,
        buildPromptRecord("prompt-b1", null, "2026-07-23T10:03:00.000Z", root, { sessionId: SESSION_B }),
        ...editAlpha.records,
        ...writeBeta.records,
        buildPromptRecord("prompt-a2", editAlpha.lastUuid, "2026-07-23T10:08:00.000Z", root),
        ...writeGamma.records,
    ]);
    const bound = trimRecordsAtRevisionTurnEnd(records, new Path(alphaPath), 1);
    // Session B's 10:03 prompt did NOT end A's turn: the same-turn 10:04 edit is kept.
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_il_e1-result"));
    // The wall-clock cut keeps B's in-window activity (beta) and drops post-bound work (gamma).
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_il_w2-result"));
    assert.ok(!bound.records.some((record) => record.uuid?.toString() === "toolu_il_w3-result"));
    // Everything strictly before promptA2's 10:08 instant survives: 8 of 10 records.
    assert.equal(bound.records.length, 8);
});

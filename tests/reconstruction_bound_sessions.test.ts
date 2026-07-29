// task 193: the per-session turn-walk half of the bound tests, split from reconstruction_bound.test.ts (task 192 pushed that file past the 250-line cap).

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { truncateRecordsAtRevisionTurnEnd } from "../src/reconstruction_bound.ts";
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
    // Scenario: two sessions ran CONCURRENTLY, so the merged time-ordered stream interleaves their turns. The turn end must be the OWNING session's next prompt — another session's prompt landing mid-turn must not cut session A's turn short — and the cut is by wall clock, so the other session's records inside the window stay in.  Merged stream: promptA1 10:00 | write alpha (A) 10:01 | promptB1 (B) 10:03 | edit alpha (A) 10:04 | write beta (B) 10:05 | promptA2 (A) 10:08 | write gamma (B) 10:09
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
    const bound = truncateRecordsAtRevisionTurnEnd(records, new Path(alphaPath), 1);
    // Session B's 10:03 prompt did NOT end A's turn: the same-turn 10:04 edit is kept.
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_il_e1-result"));
    // The wall-clock cut keeps B's in-window activity (beta) and drops post-bound work (gamma).
    assert.ok(bound.records.some((record) => record.uuid?.toString() === "toolu_il_w2-result"));
    assert.ok(!bound.records.some((record) => record.uuid?.toString() === "toolu_il_w3-result"));
    // Everything strictly before promptA2's 10:08 instant survives: 8 of 10 records.
    assert.equal(bound.records.length, 8);
});

// The task-194 cheap pre-scan: every touched file with its FIRST modifying event — exact extraction-level instants, upgraded to an earlier script-run instant only as a statically attributed CANDIDATE (basename mention), never replay-proven.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { computeReconstructionPrescan } from "../src/viewer_api_prescan.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
    SESSION_A,
    buildEditRecordPair,
    buildPromptRecord,
    buildWriteRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

// A synthetic assistant record carrying one Bash run (the reconstruction_script_stage.test.ts buildToolRecord pattern) — parse-only scans never execute it.
function buildBashRunRecord(command: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_prescan_bash", name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// alpha: Bash run mentioning its basename at 10:00:30, then write 10:01 + edit 10:02.  beta: write 10:06, never mentioned by any script.
function makePrescanFixture(): { records: TranscriptRecord[]; alphaPath: string; betaPath: string } {
    const tree = makeSourceTree("-prescan-project");
    const root = join(tree.treeRoot, "workspace");
    const alphaPath = join(root, "alpha_prescan.py");
    const betaPath = join(root, "beta_prescan.py");
    const writeAlpha = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:01:00.000Z", toolId: "toolu_prescan_w1", parentUuid: "prompt-1" },
        alphaPath,
        "line one\n",
    );
    const editAlpha = buildEditRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:02:00.000Z", toolId: "toolu_prescan_e1", parentUuid: writeAlpha.lastUuid },
        alphaPath,
        "line one\nline two\n",
        "line one\n",
        { oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [" line one", "+line two"] },
    );
    const writeBeta = buildWriteRecordPair(
        { sessionId: SESSION_A, cwd: root, timestamp: "2026-07-23T10:06:00.000Z", toolId: "toolu_prescan_w2", parentUuid: "prompt-2" },
        betaPath,
        "beta line\n",
    );
    const wireRecords: object[] = [buildPromptRecord("prompt-1", null, "2026-07-23T10:00:00.000Z", root)];
    wireRecords.push(...writeAlpha.records, ...editAlpha.records, ...writeBeta.records);
    const records = writeTranscriptFixture(tree.projectDir, "prescan.jsonl", wireRecords);
    records.push(buildBashRunRecord("python3 fix.py alpha_prescan.py", "2026-07-23T10:00:30.000Z"));
    return { records, alphaPath, betaPath };
}

test("prescan_lists_each_touched_file_with_first_exact_event", () => {
    const { records, betaPath } = makePrescanFixture();
    const entries = computeReconstructionPrescan(records);
    const betaEntry = entries.find((entry) => entry.path === betaPath);
    assert.ok(betaEntry !== undefined);
    // beta's first event is its own Write — exact, not a script candidate.
    assert.equal(betaEntry.firstEventInstant, "2026-07-23T10:06:00.000Z");
    assert.equal(betaEntry.firstEventIsScriptRunCandidate, false);
});

test("prescan_marks_earlier_script_mention_as_candidate_first_event", () => {
    const { records, alphaPath } = makePrescanFixture();
    const entries = computeReconstructionPrescan(records);
    const alphaEntry = entries.find((entry) => entry.path === alphaPath);
    assert.ok(alphaEntry !== undefined);
    // The 10:00:30 Bash run mentions alpha's basename BEFORE alpha's 10:01 Write, so it becomes the first event — flagged as a candidate, since only replay could prove the touch.
    assert.equal(alphaEntry.firstEventInstant, "2026-07-23T10:00:30.000Z");
    assert.equal(alphaEntry.firstEventIsScriptRunCandidate, true);
    // Entries come back earliest-first: alpha (10:00:30) precedes beta (10:06).
    assert.equal(entries[0]!.path, alphaPath);
});

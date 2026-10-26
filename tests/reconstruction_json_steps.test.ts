// Per-file tests for src/reconstruction_json_steps.ts: step snapshots carry changeIds, changed paths and the source session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStepSnapshots } from "../src/reconstruction_json_steps.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Uuid } from "../src/structures/domain.ts";

const SESSION = new Uuid("session-1");

// A reader with no backups to offer: every file text comes from the authored Writes.
const emptyReader: BackupReader = () => "";

// A synthetic assistant record carrying one Write tool_use of `toolId`, tagged with the session.
function buildWriteRecord(toolId: string, filePath: string, content: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        uuid: new Uuid(`${toolId}-record`),
        sessionId: SESSION,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: new Uuid(toolId), name: ToolName.Write, input: { file_path: filePath, content }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

test("test_buildStepSnapshots_numbers_steps_from_one_in_write_order", () => {
    const records = [
        buildWriteRecord("toolu_1", "/proj/a.py", "one\n", "2026-01-01T00:00:01Z"),
        buildWriteRecord("toolu_2", "/proj/b.py", "two\n", "2026-01-01T00:00:02Z"),
    ];
    const { steps } = buildStepSnapshots(records, emptyReader);
    // Verify: one step per Write, indexed from 1, in time order.
    assert.deepEqual(steps.map((step) => step.index), [1, 2]);
    assert.equal(steps[1]!.when.toISOString(), "2026-01-01T00:00:02.000Z");
});

test("test_buildStepSnapshots_resolves_the_session_of_each_step", () => {
    const records = [buildWriteRecord("toolu_1", "/proj/a.py", "one\n", "2026-01-01T00:00:01Z")];
    const { steps } = buildStepSnapshots(records, emptyReader);
    // Verify: the step's changeId is the tool_use id, which maps back to the record's session.
    assert.equal(steps[0]!.changeIds.length, 1);
    assert.equal(steps[0]!.sessionId?.toString(), "session-1");
});

test("test_buildStepSnapshots_lists_the_path_each_step_changed", () => {
    const records = [
        buildWriteRecord("toolu_1", "/proj/a.py", "one\n", "2026-01-01T00:00:01Z"),
        buildWriteRecord("toolu_2", "/proj/b.py", "two\n", "2026-01-01T00:00:02Z"),
    ];
    const { steps } = buildStepSnapshots(records, emptyReader);
    // Verify: each step names the one file its Write touched.
    assert.deepEqual(steps.map((step) => step.changedPaths), [["/proj/a.py"], ["/proj/b.py"]]);
});

test("test_buildStepSnapshots_returns_no_steps_for_no_records", () => {
    const { steps, stepFileHistories } = buildStepSnapshots([], emptyReader);
    assert.equal(steps.length, 0);
    assert.equal(stepFileHistories.length, 0);
});

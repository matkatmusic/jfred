// Tests for the script-execution memo: the exec gate and the pre-baseline flag invalidate it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRunOnce } from "../src/reconstruction_script_runs.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
    isImpureExecutionAllowed,
    setImpureExecutionAllowed,
} from "../src/reconstruction_exec_gate.ts";
import { setPreBaselineReconstructionAllowed } from "../src/reconstruction_base_commit.ts";

// A synthetic assistant record with one tool_use of `name`, mirroring tests/reconstruction_script_stage.test.ts.
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A Write plus a script run over it: enough records for findScriptExecutionRuns to yield one run.
function buildScriptRunRecords(): TranscriptRecord[] {
    const renameScript = 'text = open("core_one.py").read()\n'
        + 'open("core_one.py", "w").write(text.replace("f_one", "alpha"))\n';
    return [
        buildToolRecord(ToolName.Write, { file_path: "/proj/core_one.py", content: "def f_one(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: renameScript }, "2026-01-01T00:00:02Z"),
    ];
}

// A reader with no backups to offer: every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

test("test_execution_memo_is_invalidated_when_the_exec_gate_flips", () => {
    // Scenario: a consented build's sandbox results are never served into a declined rebuild.
    assert.equal(isImpureExecutionAllowed(), true);
    const records = buildScriptRunRecords();
    const run = findScriptExecutionRuns(records)[0]!;
    const gateOn = executeRunOnce(run, records, emptyReader);
    try {
        setImpureExecutionAllowed(false);
        const gateOff = executeRunOnce(run, records, emptyReader);
        assert.notEqual(gateOff, gateOn);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_derived_caches_rebuild_when_the_pre_baseline_flag_flips", () => {
    // Scenario (task 151): a "No" build's executions are never served into a "Yes" rebuild.
    const records = buildScriptRunRecords();
    const run = findScriptExecutionRuns(records)[0]!;
    const allowed = executeRunOnce(run, records, emptyReader);
    try {
        setPreBaselineReconstructionAllowed(false);
        const declined = executeRunOnce(run, records, emptyReader);
        assert.notEqual(declined, allowed);
    } finally {
        setPreBaselineReconstructionAllowed(true);
    }
});

test("test_execution_memo_is_reused_for_the_same_records_and_reader", () => {
    // Scenario: the same records, reader, and gate return the same RunExecution instance.
    const records = buildScriptRunRecords();
    const run = findScriptExecutionRuns(records)[0]!;
    const first = executeRunOnce(run, records, emptyReader);
    const second = executeRunOnce(run, records, emptyReader);
    assert.equal(second, first);
});

// Tests for the pass-dedup memos (fix-1 bandaid): branch selection and top-level
// reconstructFileOver return the SAME instances for the same inputs, so the document build's
// repeated passes stop re-running deterministic work — and the exec-gate flip invalidates the
// reconstruction memo (a declined build's histories must never serve a consented build).

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { selectBranchRecords, selectLiveBranch } from "../src/reconstruction_branch.ts";
import { reconstructAll } from "../src/reconstruction_engine.ts";
import { executeRunOnce } from "../src/reconstruction_script_runs.ts";
import { findScriptExecutionRuns } from "../src/reconstruction_script_execution.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import {
    isImpureExecutionAllowed,
    setImpureExecutionAllowed,
} from "../src/reconstruction_exec_gate.ts";
import { S19_JSONL } from "./fixtures.ts";

function buildChainRecord(type: RecordType, uuid: string, parent: string | null): TranscriptRecord {
    return { type, uuid: new Uuid(uuid), parentUuid: parent === null ? null : new Uuid(parent) } as TranscriptRecord;
}

// A fully-linear conversation: every uuid'd record sits on the surviving trunk, and the
// last-prompt head marker is uuid-less (always kept) — so branch selection drops nothing.
function buildLinearTrunkRecords(): TranscriptRecord[] {
    return [
        buildChainRecord(RecordType.user, "A", null),
        buildChainRecord(RecordType.assistant, "B", "A"),
        buildChainRecord(RecordType.user, "C", "B"),
        { type: RecordType.lastPrompt, leafUuid: "C" } as unknown as TranscriptRecord,
    ];
}

test("test_selectLiveBranch_returns_the_input_array_when_nothing_is_dropped", () => {
    // Scenario: when the surviving trunk covers every record, the live-branch "selection" is
    // the whole transcript; returning a fresh filtered copy gave it a new identity and defeated
    // every identity-keyed memo on the document build's second pass (steps use the full array).
    const records = buildLinearTrunkRecords();
    assert.equal(selectLiveBranch(records), records);
});

test("test_selectBranchRecords_returns_the_input_array_when_the_tip_covers_every_record", () => {
    // Scenario: same identity contract for per-tip selection — a tip whose ancestor chain plus
    // the uuid-less meta records span the whole transcript must return the input array itself.
    const records = buildLinearTrunkRecords();
    assert.equal(selectBranchRecords(records, new Uuid("C")), records);
});

test("test_selectLiveBranch_still_filters_when_records_are_dropped", () => {
    // Scenario: a rewound session (S19) has abandoned-branch records — the live selection must
    // remain a strict subset, NOT the input array; the identity collapse is content-equal only.
    const records = loadTranscript(S19_JSONL);
    const live = selectLiveBranch(records);
    assert.notEqual(live, records);
    assert.ok(live.length < records.length);
});

test("test_selectLiveBranch_returns_the_same_array_instance_for_the_same_records", () => {
    // Scenario: branch selection is memoized per records-array identity, so downstream
    // identity-keyed caches (script executions, file histories) hit across document passes.
    const records = loadTranscript(S19_JSONL);
    assert.equal(selectLiveBranch(records), selectLiveBranch(records));
});

test("test_reconstructAll_reuses_memoized_histories_across_passes", () => {
    // Scenario: two reconstructAll passes over the same records (the document build's pass 1
    // and pass 5) share the memoized per-file revisions instead of recomputing them.
    const records = loadTranscript(S19_JSONL);
    const first = reconstructAll(records);
    const second = reconstructAll(records);
    assert.ok(first.length > 0);
    for (const [index, history] of first.entries()) {
        assert.equal(second[index]!.revisions, history.revisions);
    }
});

test("test_reconstruction_memo_is_invalidated_when_the_exec_gate_flips", () => {
    // Scenario: histories reconstructed with the gate on must not be served after it turns off
    // (and vice versa) — the gate changes what injectScriptExecutions may produce.
    assert.equal(isImpureExecutionAllowed(), true);
    const records = loadTranscript(S19_JSONL);
    const gateOn = reconstructAll(records);
    try {
        setImpureExecutionAllowed(false);
        const gateOff = reconstructAll(records);
        assert.notEqual(gateOff[0]!.revisions, gateOn[0]!.revisions);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

// A synthetic assistant record carrying one tool_use of `name` with `input`, at `timestamp`
// (mirrors the setup in tests/reconstruction_script_stage.test.ts).
function buildToolRecord(name: ToolName, input: Record<string, unknown>, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A Write plus a script run over it — enough records for findScriptExecutionRuns to yield one run.
function buildScriptRunRecords(): TranscriptRecord[] {
    const renameScript = 'text = open("core_one.py").read()\n'
        + 'open("core_one.py", "w").write(text.replace("f_one", "alpha"))\n';
    return [
        buildToolRecord(ToolName.Write, { file_path: "/proj/core_one.py", content: "def f_one(): pass\n" }, "2026-01-01T00:00:01Z"),
        buildToolRecord(ToolName.CtxExecute, { cwd: "/proj", code: renameScript }, "2026-01-01T00:00:02Z"),
    ];
}

// A reader with no backups to offer — every pre-state seed comes from the authored Writes.
const emptyReader: BackupReader = () => "";

test("test_execution_memo_is_invalidated_when_the_exec_gate_flips", () => {
    // Scenario: a consented build's sandbox results must not be served into a declined rebuild
    // of the same records array (and vice versa) — the executions memo joins the same
    // reader/exec-gate validity rule as the history and lineage-seed memos.
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

test("test_execution_memo_is_reused_for_the_same_records_and_reader", () => {
    // Scenario: with the same records array, the same reader, and an unchanged gate, the second
    // call must return the SAME RunExecution instance — the memo still hits (each sandbox run
    // costs ~100ms; the document build multiplies call sites).
    const records = buildScriptRunRecords();
    const run = findScriptExecutionRuns(records)[0]!;
    const first = executeRunOnce(run, records, emptyReader);
    const second = executeRunOnce(run, records, emptyReader);
    assert.equal(second, first);
});

test("test_branch_selections_survive_an_exec_gate_flip", () => {
    // Scenario: branch selections are pure functions of the records alone — the exec gate must
    // NOT invalidate them (pins the corpus's two-group validity split: records-pure selections
    // vs reader/gate-validated derived caches).
    const records = loadTranscript(S19_JSONL);
    const before = selectLiveBranch(records);
    try {
        setImpureExecutionAllowed(false);
        assert.equal(selectLiveBranch(records), before);
    } finally {
        setImpureExecutionAllowed(true);
    }
});

test("test_derived_caches_are_invalidated_when_the_reader_identity_changes", () => {
    // Scenario: two distinct reader closures — even behaviorally identical ones — must not share
    // memoized histories: the derived-cache group is keyed on the reader's IDENTITY.
    const records = loadTranscript(S19_JSONL);
    const readerA: BackupReader = () => "";
    const readerB: BackupReader = () => "";
    const withReaderA = reconstructAll(records, readerA);
    const withReaderB = reconstructAll(records, readerB);
    assert.ok(withReaderA.length > 0);
    assert.notEqual(withReaderB[0]!.revisions, withReaderA[0]!.revisions);
});


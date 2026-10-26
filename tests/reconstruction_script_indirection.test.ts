// Per-file tests for src/reconstruction_script_indirection.ts: a run that only calls a written script file runs that file's Write body.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    applyScriptIndirection,
    collectWrittenContentByBasename,
    extractPathBasename,
} from "../src/reconstruction_script_indirection.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// A synthetic assistant record with one Write tool_use of `toolId`.
function buildWriteRecord(toolId: string, filePath: string, content: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: toolId, name: ToolName.Write, input: { file_path: filePath, content }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A synthetic user record whose tool_result for `toolId` reports an error.
function buildErroredResultRecord(toolId: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.user,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_result, tool_use_id: toolId, is_error: true, content: "failed" }] },
    } as unknown as TranscriptRecord;
}

function buildRun(code: string, timestamp: string, executorKind: ScriptExecutorKind): ScriptRun {
    return { code, timestamp: new Date(timestamp), executorKind, language: "shell" };
}

test("test_extractPathBasename_returns_the_last_path_segment", () => {
    assert.equal(extractPathBasename("/proj/sub/apply.py"), "apply.py");
    assert.equal(extractPathBasename("apply.py"), "apply.py");
});

test("test_collectWrittenContentByBasename_keeps_every_rewrite_of_a_file", () => {
    // Steps: two Writes of the same script name under different folders.
    const records = [
        buildWriteRecord("toolu_1", "/proj/apply.py", "first", "2026-01-01T00:00:01Z"),
        buildWriteRecord("toolu_2", "/other/apply.py", "second", "2026-01-01T00:00:02Z"),
    ];
    const bodies = collectWrittenContentByBasename(records).get("apply.py");
    // Verify: both bodies are kept in record order.
    assert.deepEqual(bodies?.map((body) => body.content), ["first", "second"]);
});

test("test_collectWrittenContentByBasename_skips_a_write_whose_result_errored", () => {
    const records = [
        buildWriteRecord("toolu_bad", "/proj/apply.py", "never landed", "2026-01-01T00:00:01Z"),
        buildErroredResultRecord("toolu_bad", "2026-01-01T00:00:02Z"),
    ];
    assert.equal(collectWrittenContentByBasename(records).has("apply.py"), false);
});

test("test_applyScriptIndirection_replaces_the_code_with_the_written_script_body", () => {
    const written = collectWrittenContentByBasename([
        buildWriteRecord("toolu_1", "/proj/apply.py", "print('body')", "2026-01-01T00:00:01Z"),
    ]);
    const run = buildRun("python3 apply.py --dry-run", "2026-01-01T00:00:02Z", ScriptExecutorKind.python);
    const resolved = applyScriptIndirection(run, written);
    // Verify: the body replaces the command and the script file name is recorded.
    assert.equal(resolved.code, "print('body')");
    assert.equal(resolved.invokedScriptFile, "apply.py");
});

test("test_applyScriptIndirection_uses_the_latest_body_written_before_the_run", () => {
    const written = collectWrittenContentByBasename([
        buildWriteRecord("toolu_1", "/proj/apply.py", "old", "2026-01-01T00:00:01Z"),
        buildWriteRecord("toolu_2", "/proj/apply.py", "new", "2026-01-01T00:00:03Z"),
        buildWriteRecord("toolu_3", "/proj/apply.py", "later rewrite", "2026-01-01T00:00:09Z"),
    ]);
    const run = buildRun("node apply.py", "2026-01-01T00:00:05Z", ScriptExecutorKind.python);
    assert.equal(applyScriptIndirection(run, written).code, "new");
});

test("test_applyScriptIndirection_flips_a_bash_run_of_a_py_file_to_python", () => {
    const written = collectWrittenContentByBasename([
        buildWriteRecord("toolu_1", "/proj/apply.py", "print(1)", "2026-01-01T00:00:01Z"),
    ]);
    const run = buildRun("bash apply.py", "2026-01-01T00:00:02Z", ScriptExecutorKind.bash);
    const resolved = applyScriptIndirection(run, written);
    // Verify: kind and language both read as python.
    assert.equal(resolved.executorKind, ScriptExecutorKind.python);
    assert.equal(resolved.language, "python");
});

test("test_applyScriptIndirection_resolves_an_exec_open_wrapper", () => {
    const written = collectWrittenContentByBasename([
        buildWriteRecord("toolu_1", "/proj/rename_inv.py", "print(2)", "2026-01-01T00:00:01Z"),
    ]);
    const run = buildRun('exec(open("rename_inv.py").read())', "2026-01-01T00:00:02Z", ScriptExecutorKind.python);
    assert.equal(applyScriptIndirection(run, written).code, "print(2)");
});

test("test_applyScriptIndirection_returns_the_run_unchanged_when_no_script_was_written", () => {
    const run = buildRun("python3 missing.py", "2026-01-01T00:00:02Z", ScriptExecutorKind.python);
    assert.equal(applyScriptIndirection(run, new Map()), run);
});

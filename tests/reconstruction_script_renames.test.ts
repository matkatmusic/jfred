import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScriptRenameEvents } from "../src/reconstruction_script_renames.ts";
import { BlockType, EventKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

// --- extractScriptRenameEvents: script-run renames recovered from printed stdout -------------------

// An assistant record writing `filePath` (populates the "written" set the phantom guard checks).
function buildWriteRecord(id: string, filePath: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id, name: ToolName.Write, input: { file_path: filePath, content: "x" }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// An assistant record running `code` through the MCP ctx_execute sandbox with `cwd`.
function buildMcpRunRecord(id: string, cwd: string, code: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id, name: ToolName.CtxExecute, input: { cwd, code }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A user record carrying the result for `toolUseId`, with the run's printed text in the MCP array shape.
function buildMcpResultRecord(toolUseId: string, text: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.user,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_result, tool_use_id: toolUseId, content: text, is_error: false }] },
        toolUseResult: [{ type: "text", text }],
    } as unknown as TranscriptRecord;
}

// A printed `old -> new` line for a previously-written file becomes one rename, resolved against the run's
// cwd and stamped at the RESULT record's instant — while the echoed f-string code line `{name}.py -> …`
// (braces are not path chars) in the SAME result yields nothing.
test("test_extract_script_rename_pulls_printed_move_and_ignores_code_echo", () => {
    const records = [
        buildWriteRecord("toolu_w1", "/work/one.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord("toolu_run", "/work", 'import shutil\nshutil.move("one.py", "core_one.py")', "2026-01-01T00:00:02Z"),
        buildMcpResultRecord("toolu_run", '```python\nprint(f"{name}.py -> core_{name}.py")\n```\n\none.py -> core_one.py\n', "2026-01-01T00:00:03Z"),
    ];
    const renames = extractScriptRenameEvents(records).filter((event) => event.kind === EventKind.rename);
    assert.equal(renames.length, 1);
    assert.equal(renames[0]!.from.toString(), "/work/one.py");
    assert.equal(renames[0]!.to.toString(), "/work/core_one.py");
    // Stamped at the RESULT record — the execution provably finished by then. The tool_use instant
    // is only when the run was REQUESTED: s87's consent-delayed MCP move sat pending 6 minutes.
    assert.equal(renames[0]!.timestamp.getTime(), new Date("2026-01-01T00:00:03Z").getTime());
});

// Consent-delayed execution (s87 steps 110–118): an MCP run REQUESTED at 00:24 whose result only
// lands at 00:31 executed somewhere in between — Bash runs at 00:30 prove the file had not moved
// yet. The rename must stamp at the result instant so those interleaved events order BEFORE it.
test("test_extract_script_rename_stamps_consent_delayed_run_at_result_instant", () => {
    const records = [
        buildWriteRecord("toolu_w1", "/work/inventory_core.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord("toolu_move", "/work", "…", "2026-01-01T00:24:29Z"),
        buildMcpResultRecord("toolu_move", "Renamed: inventory_core.py -> core_inventory.py\n", "2026-01-01T00:31:00Z"),
    ];
    const renames = extractScriptRenameEvents(records).filter((event) => event.kind === EventKind.rename);
    assert.equal(renames.length, 1);
    assert.equal(renames[0]!.timestamp.getTime(), new Date("2026-01-01T00:31:00Z").getTime());
});

// The `Renamed: <old> -> <new>` prefix form (s84) is matched by the arrow anywhere in the line, and the
// Bash `.stdout` result shape is read the same as the MCP array shape.
test("test_extract_script_rename_handles_prefix_and_bash_stdout_shape", () => {
    const bashRun = {
        type: RecordType.assistant,
        timestamp: new Date("2026-01-01T00:00:02Z"),
        message: { content: [{ type: BlockType.tool_use, id: "toolu_bash", name: ToolName.Bash, input: { command: "python3 move_files.py", cwd: "/w" }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
    const bashResult = {
        type: RecordType.user,
        timestamp: new Date("2026-01-01T00:00:03Z"),
        message: { content: [{ type: BlockType.tool_result, tool_use_id: "toolu_bash", content: "", is_error: false }] },
        toolUseResult: { stdout: "Renamed: inventory.py -> core_inventory.py\n", stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
    } as unknown as TranscriptRecord;
    const records = [buildWriteRecord("toolu_w", "/w/inventory.py", "2026-01-01T00:00:01Z"), bashRun, bashResult];
    const renames = extractScriptRenameEvents(records).filter((event) => event.kind === EventKind.rename);
    assert.equal(renames.length, 1);
    assert.equal(renames[0]!.from.toString(), "/w/inventory.py");
    assert.equal(renames[0]!.to.toString(), "/w/core_inventory.py");
});

// Phantom guard: a printed pair whose SOURCE was never written/edited is dropped (no invented lineage).
test("test_extract_script_rename_drops_unwritten_source", () => {
    const records = [
        buildMcpRunRecord("toolu_run", "/work", "…", "2026-01-01T00:00:02Z"),
        buildMcpResultRecord("toolu_run", "unknown.py -> z.py\n", "2026-01-01T00:00:03Z"),
    ];
    assert.equal(extractScriptRenameEvents(records).length, 0);
});

// Code-literal channel (s87 step 89): a COMPLETED run whose code contains a two-string-literal
// `shutil.move("a.py", "b.py")` yields a rename even when the run prints NO `old -> new` line.
// The variable form `shutil.move(src, dst)` in the same code yields nothing (arguments unknown).
test("test_extract_script_rename_from_code_literal_move_without_stdout_line", () => {
    const records = [
        buildWriteRecord("toolu_w1", "/work/one.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord(
            "toolu_run",
            "/work",
            'import shutil\nshutil.move("one.py", "core_one.py")\nfor src, dst in pairs:\n    shutil.move(src, dst)',
            "2026-01-01T00:00:02Z",
        ),
        buildMcpResultRecord("toolu_run", "done\n", "2026-01-01T00:00:03Z"),
    ];
    const renames = extractScriptRenameEvents(records).filter((event) => event.kind === EventKind.rename);
    assert.equal(renames.length, 1);
    assert.equal(renames[0]!.from.toString(), "/work/one.py");
    assert.equal(renames[0]!.to.toString(), "/work/core_one.py");
    // Stamped at the result record: the code provably ran by then (see the consent-delay test).
    assert.equal(renames[0]!.timestamp.getTime(), new Date("2026-01-01T00:00:03Z").getTime());
});

// A code-literal move in a run with NO tool_result (never confirmed to complete) yields nothing —
// the never-fabricate rule: only a KNOWN completed run's code counts as rename evidence.
test("test_extract_script_rename_ignores_code_literal_of_uncompleted_run", () => {
    const records = [
        buildWriteRecord("toolu_w1", "/work/one.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord("toolu_run", "/work", 'import shutil\nshutil.move("one.py", "core_one.py")', "2026-01-01T00:00:02Z"),
    ];
    assert.equal(extractScriptRenameEvents(records).length, 0);
});

// Chain-aware phantom guard (s87 step 106): run 2 renames a file BORN as run 1's destination.
// Records arrive in readdir order (run 2's records BEFORE run 1's), so a record-order guard sees
// run 2's source as never-written and drops it. Candidates must be ordered by EXECUTOR timestamp,
// each accepted source ∈ written basenames ∪ destinations of already-accepted renames.
test("test_extract_script_rename_accepts_chain_in_timestamp_order_despite_readdir_order", () => {
    const records = [
        // run 2 (later instant) loads FIRST: b.py -> c.py, b.py born as run 1's destination.
        buildMcpRunRecord("toolu_run2", "/work", "…", "2026-01-01T00:00:04Z"),
        buildMcpResultRecord("toolu_run2", "b.py -> c.py\n", "2026-01-01T00:00:05Z"),
        // run 1 (earlier instant) loads SECOND: a.py -> b.py, a.py written directly.
        buildWriteRecord("toolu_w1", "/work/a.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord("toolu_run1", "/work", "…", "2026-01-01T00:00:02Z"),
        buildMcpResultRecord("toolu_run1", "a.py -> b.py\n", "2026-01-01T00:00:03Z"),
    ];
    const renames = extractScriptRenameEvents(records).filter((event) => event.kind === EventKind.rename);
    assert.equal(renames.length, 2);
    // accepted in timestamp order: run 1's move first, run 2's chained move second.
    assert.equal(renames[0]!.from.toString(), "/work/a.py");
    assert.equal(renames[0]!.to.toString(), "/work/b.py");
    assert.equal(renames[1]!.from.toString(), "/work/b.py");
    assert.equal(renames[1]!.to.toString(), "/work/c.py");
});

// A function-rename print (`f_one -> alpha`, no dot-extension on either side) is not a file rename.
test("test_extract_script_rename_ignores_extensionless_function_rename", () => {
    const records = [
        buildWriteRecord("toolu_w", "/work/core_one.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord("toolu_run", "/work", "…", "2026-01-01T00:00:02Z"),
        buildMcpResultRecord("toolu_run", "f_one -> alpha\nf_two -> beta\n", "2026-01-01T00:00:03Z"),
    ];
    assert.equal(extractScriptRenameEvents(records).length, 0);
});

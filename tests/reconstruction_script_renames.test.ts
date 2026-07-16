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
// cwd and stamped at the RUN's instant — while the echoed f-string code line `{name}.py -> …` (braces are not
// path chars) in the SAME result yields nothing.
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
    // Stamped at the executor run, not the result record, so later edits/beacons order after it.
    assert.equal(renames[0]!.timestamp.getTime(), new Date("2026-01-01T00:00:02Z").getTime());
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

// A function-rename print (`f_one -> alpha`, no dot-extension on either side) is not a file rename.
test("test_extract_script_rename_ignores_extensionless_function_rename", () => {
    const records = [
        buildWriteRecord("toolu_w", "/work/core_one.py", "2026-01-01T00:00:01Z"),
        buildMcpRunRecord("toolu_run", "/work", "…", "2026-01-01T00:00:02Z"),
        buildMcpResultRecord("toolu_run", "f_one -> alpha\nf_two -> beta\n", "2026-01-01T00:00:03Z"),
    ];
    assert.equal(extractScriptRenameEvents(records).length, 0);
});

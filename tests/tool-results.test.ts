import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildToolUseNamesById,
    getToolResultForUserRecord,
} from "../src/structures/tool-results.ts";
import type {
    BashResult,
    WriteResult,
    ReadResult,
    EditResult,
} from "../src/structures/tool-result-shapes.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";
import { loadRecords } from "./utilities.ts";
import { S1_JSONL, S2_JSONL } from "./fixtures.ts";
import { join } from "node:path";
import {
    SESSION_A,
    buildErroredToolResultRecordPair,
    makeSourceTree,
    writeTranscriptFixture,
} from "./multi-source-test-helpers.ts";

// Finds the first resolved tool result of a given tool in a transcript, so each test skips the scan.
function findToolResult(file: string, toolName: ToolName) {
    const records = loadRecords(file);
    const nameById = buildToolUseNamesById(records);
    for (const record of records) {
        const resolved = getToolResultForUserRecord(record, nameById);
        if (resolved?.toolName === toolName) {
            return resolved.result;
        }
    }
    return undefined;
}

test("test_write_result_carries_originalFile_and_empty_structuredPatch", () => {
    // Scenario: the Write tool's structured result is typed with its s1 fields,
    // including a null originalFile (a create) and an empty structuredPatch.
    // Steps:
    // find the Write tool result attached to a user record in s1.
    const writeResult = findToolResult(S1_JSONL, ToolName.Write) as
        | WriteResult
        | undefined;
    // s1 must contain a Write result.
    if (!writeResult) {
        assert.fail("expected a Write tool result in s1");
    }
    // it is a create (originalFile null) with no diff hunks.
    assert.equal(writeResult.type, "create");
    assert.equal(writeResult.originalFile, null);
    assert.deepEqual(writeResult.structuredPatch, []);
    assert.equal(typeof writeResult.content, "string");
    // its filePath is a Path domain object, not a primitive.
    assert.ok(writeResult.filePath instanceof Path);
});

test("test_bash_result_carries_stdout_and_stderr", () => {
    // Scenario: the Bash result is typed with its s1 fields.  Steps: find a Bash result in s1.
    const bashResult = findToolResult(S1_JSONL, ToolName.Bash) as
        | BashResult
        | undefined;
    // s1 must contain a Bash result.
    if (!bashResult) {
        assert.fail("expected a Bash tool result in s1");
    }
    // stdout and stderr are strings; interrupted is a boolean.
    assert.equal(typeof bashResult.stdout, "string");
    assert.equal(typeof bashResult.stderr, "string");
    assert.equal(typeof bashResult.interrupted, "boolean");
});

test("test_read_result_carries_file_with_path_and_line_counts", () => {
    // Scenario: the s2 Read result is typed; its filePath becomes a Path.  Steps: find the Read result in s2.
    const readResult = findToolResult(S2_JSONL, ToolName.Read) as
        | ReadResult
        | undefined;
    // s2 must contain a Read result.
    if (!readResult) {
        assert.fail("expected a Read tool result in s2");
    }
    // its nested file.filePath is a Path domain object, not a primitive.
    assert.ok(readResult.file.filePath instanceof Path);
    // its content is a string and its line counts are numbers.
    assert.equal(typeof readResult.file.content, "string");
    assert.equal(typeof readResult.file.numLines, "number");
    assert.equal(typeof readResult.file.totalLines, "number");
});

test("test_edit_result_carries_path_and_nonempty_structured_patch", () => {
    // Scenario: the s2 Edit result has a Path and a non-empty structuredPatch.  Steps: find the Edit result in s2.
    const editResult = findToolResult(S2_JSONL, ToolName.Edit) as
        | EditResult
        | undefined;
    // s2 must contain an Edit result.
    if (!editResult) {
        assert.fail("expected an Edit tool result in s2");
    }
    // its filePath is a Path; oldString/newString are strings; replaceAll a bool.
    assert.ok(editResult.filePath instanceof Path);
    assert.equal(typeof editResult.oldString, "string");
    assert.equal(typeof editResult.newString, "string");
    assert.equal(typeof editResult.replaceAll, "boolean");
    // its structuredPatch carries at least one hunk with numeric line ranges and a string[] of diff lines.
    assert.ok(editResult.structuredPatch.length > 0);
    const hunk = editResult.structuredPatch[0]!;
    assert.equal(typeof hunk.oldStart, "number");
    assert.equal(typeof hunk.newStart, "number");
    assert.ok(Array.isArray(hunk.lines));
    assert.equal(typeof hunk.lines[0], "string");
});

test("test_errored_tool_run_with_string_result_resolves_to_undefined", () => {
    // Scenario: a failed Read reports a plain string result; resolution yields undefined and does not crash.
    const tree = makeSourceTree("-errored-read");
    const workspaceRoot = join(tree.treeRoot, "workspace");
    const erroredRead = buildErroredToolResultRecordPair(
        { sessionId: SESSION_A, cwd: workspaceRoot, timestamp: "2026-07-24T10:01:00.000Z", toolId: "toolu_err_r1", parentUuid: null },
        "Read",
        { file_path: join(workspaceRoot, "missing.py") },
        "Error: File does not exist.",
    );
    const records = writeTranscriptFixture(tree.projectDir, "a.jsonl", erroredRead.records);
    const nameById = buildToolUseNamesById(records);
    // every record resolves without throwing; the errored result record resolves to undefined.
    for (const record of records) {
        assert.equal(getToolResultForUserRecord(record, nameById), undefined);
    }
});



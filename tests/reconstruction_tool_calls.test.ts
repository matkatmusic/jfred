// The document's toolCalls[]: every non-file-edit tool call in the transcript — tool_use blocks
// from assistant records, plus the rewritten command a PreToolUse hook actually ran when it
// differs from the tool_use's own command (s39's `rtk ls`). These become the timeline's
// un-bubbled `* <summary> * [{ }] <TS> L:n` rows (item 55); Write/Edit stay file chips.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { Uuid } from "../src/structures/domain.ts";
import { ToolName } from "../src/structures/vocabulary.ts";
import { computeToolCallSummary } from "../src/reconstruction_tool_calls.ts";
import { S39_JSONL_PATHS } from "./fixtures.ts";

// The git-baseline session alone (b9783f4b…): its tool calls are known line-by-line, so the
// precise assertions scope to it; the sibling session (81e41fb9…) is asserted separately.
const S39_SEED_SESSION_PATHS = S39_JSONL_PATHS.filter((path) => path.toString().includes("b9783f4b"));
const seedDocument = buildProjectDocument(S39_SEED_SESSION_PATHS, undefined);
const fullDocument = buildProjectDocument(S39_JSONL_PATHS, undefined);

test("test_s39_bash_tool_calls_are_extracted", () => {
    // Scenario: the s39 git-baseline session runs four plain Bash commands (git init, ls,
    // mkdir -p, git add); each must surface as a ToolCall with domain-typed fields.
    const summaries = seedDocument.toolCalls.map((call) => call.summary);
    assert.ok(summaries.includes("git init"));
    assert.ok(summaries.some((summary) => summary.startsWith("ls /private/")));
    assert.ok(summaries.some((summary) => summary.startsWith("mkdir -p")));
    assert.ok(summaries.includes("git add orders.py tests/"));
    for (const call of seedDocument.toolCalls) {
        assert.equal(call.toolName, ToolName.Bash);
        assert.ok(call.timestamp instanceof Date);
        assert.ok(call.uuid instanceof Uuid);
        assert.ok(call.toolUseId instanceof Uuid);
    }
});

test("test_s39_rtk_rewrite_hook_adds_a_row_for_the_rewritten_command", () => {
    // Scenario: the `ls` tool_use (toolu_015S4…) was rewritten by the rtk-rewrite PreToolUse
    // hook to `rtk ls …` before execution — BOTH the original and the rewritten command get a
    // row, sharing the toolUseId; the rewrite row is anchored at the hook attachment record.
    const rewriteRows = seedDocument.toolCalls.filter((call) => call.summary.startsWith("rtk ls "));
    assert.equal(rewriteRows.length, 1);
    assert.equal(rewriteRows[0]!.toolUseId.toString(), "toolu_015S4Xy7zXKZsjauZticmEj9");
    assert.equal(rewriteRows[0]!.uuid.toString(), "26897912-0823-44cb-9be0-c9872027131e");
    assert.equal(rewriteRows[0]!.toolName, ToolName.Bash);
    const originalRows = seedDocument.toolCalls.filter((call) =>
        call.toolUseId.toString() === "toolu_015S4Xy7zXKZsjauZticmEj9" && call.summary.startsWith("ls "));
    assert.equal(originalRows.length, 1);
});

test("test_write_and_edit_tool_uses_are_excluded_from_tool_calls", () => {
    // Scenario: Write/Edit calls are represented as file chips, never rows — neither their
    // tool_use blocks nor their hook attachments may produce a ToolCall.
    const toolNames = fullDocument.toolCalls.map((call) => call.toolName);
    assert.ok(!toolNames.includes(ToolName.Write));
    assert.ok(!toolNames.includes(ToolName.Edit));
    const toolUseIds = fullDocument.toolCalls.map((call) => call.toolUseId.toString());
    assert.ok(!toolUseIds.includes("toolu_01TXzRmSw6NPb8H2HC9WhxD7"));
    assert.ok(!toolUseIds.includes("toolu_01MbuZ8HyCSqGAuVYGwD2vRQ"));
});

test("test_s39_sibling_session_read_call_gets_a_row", () => {
    // Scenario: "all tool calls" includes non-Bash tools — the sibling session's single Read
    // tool_use must surface as a row summarized by its file_path.
    const readRows = fullDocument.toolCalls.filter((call) => call.toolName === ToolName.Read);
    assert.equal(readRows.length, 1);
    assert.ok(readRows[0]!.summary.startsWith("/private/var/"));
});

test("test_compute_tool_call_summary_prefers_command_then_file_path", () => {
    // Scenario: a row's one-line summary picks the most command-like input field: command wins
    // over file_path, file_path wins over pattern, pattern wins over any other string input.
    assert.equal(computeToolCallSummary({ input: { command: "git init", file_path: "x" } }), "git init");
    assert.equal(computeToolCallSummary({ input: { file_path: "/a/b.py" } }), "/a/b.py");
    assert.equal(computeToolCallSummary({ input: { pattern: "foo" } }), "foo");
    assert.equal(computeToolCallSummary({ input: { query: "bar" } }), "bar");
    assert.equal(computeToolCallSummary({ input: { count: 3 } }), "");
});


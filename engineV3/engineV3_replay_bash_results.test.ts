import { test } from "node:test";
import assert from "node:assert/strict";

import type { JSONLLine } from "./engineV3.ts";
import { collectBashCallResults, isNeverRanResult, type BashCallResult } from "./engineV3_replay_bash_results.ts";

function makeToolUseLine(toolUseId: string, toolName: string, seconds: number | undefined): JSONLLine {
    const timestamp = seconds === undefined ? undefined : new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
    const block = { type: "tool_use", id: toolUseId, name: toolName, input: {}, caller: { type: "direct" } };
    return { type: "assistant", timestamp, message: { content: [block] } } as unknown as JSONLLine;
}

function makeToolResultLine(toolUseId: string, seconds: number, content: unknown, isError: boolean): JSONLLine {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
    const block = { type: "tool_result", tool_use_id: toolUseId, content, is_error: isError };
    return { type: "user", timestamp, message: { content: [block] } } as unknown as JSONLLine;
}

function makeResult(isError: boolean, resultText: string): BashCallResult {
    return { toolUseId: "t1" as never, startMs: 0, endMs: 0, isError, resultText, command: "" };
}

test("test_collectBashCallResults_records_the_time_window_of_a_Bash_call", () => {
    // Scenario: the call starts at 10s and its result arrives at 12s.
    const lines = [makeToolUseLine("t1", "Bash", 10), makeToolResultLine("t1", 12, "ok", false)];
    const result = collectBashCallResults(lines).get("t1") as BashCallResult;
    assert.equal(result.startMs, Date.UTC(2026, 0, 1, 0, 0, 10));
    assert.equal(result.endMs, Date.UTC(2026, 0, 1, 0, 0, 12));
});

test("test_collectBashCallResults_records_the_command_of_a_Bash_call", () => {
    const callLine = makeToolUseLine("t1", "Bash", 10);
    ((callLine.message as { content: { input: object }[] }).content[0] as { input: object }).input = { command: "git status" };
    const result = collectBashCallResults([callLine, makeToolResultLine("t1", 12, "ok", false)]).get("t1") as BashCallResult;
    assert.equal(result.command, "git status");
});

test("test_collectBashCallResults_reads_string_result_text", () => {
    const lines = [makeToolUseLine("t1", "Bash", 10), makeToolResultLine("t1", 12, "hello", false)];
    const result = collectBashCallResults(lines).get("t1") as BashCallResult;
    assert.equal(result.resultText, "hello");
    assert.equal(result.isError, false);
});

test("test_collectBashCallResults_joins_the_texts_of_a_block_list", () => {
    const content = [{ type: "text", text: "one" }, { type: "text", text: "two" }];
    const lines = [makeToolUseLine("t1", "Bash", 10), makeToolResultLine("t1", 12, content, false)];
    const result = collectBashCallResults(lines).get("t1") as BashCallResult;
    assert.equal(result.resultText, "one\ntwo");
});

test("test_collectBashCallResults_reads_is_error_true", () => {
    const lines = [makeToolUseLine("t1", "Bash", 10), makeToolResultLine("t1", 12, "bad", true)];
    const result = collectBashCallResults(lines).get("t1") as BashCallResult;
    assert.equal(result.isError, true);
});

test("test_collectBashCallResults_leaves_out_a_Bash_call_with_no_result", () => {
    const lines = [makeToolUseLine("t1", "Bash", 10)];
    assert.equal(collectBashCallResults(lines).size, 0);
});

test("test_collectBashCallResults_leaves_out_a_tool_that_is_not_Bash", () => {
    const lines = [makeToolUseLine("t1", "mcp__ctx_execute", 10), makeToolResultLine("t1", 12, "ok", false)];
    assert.equal(collectBashCallResults(lines).size, 0);
});

test("test_collectBashCallResults_records_a_ctx_execute_call", () => {
    // Scenario: a ctx_execute call and its result are paired like a Bash call.
    const lines = [makeToolUseLine("t1", "mcp__plugin_context-mode_context-mode__ctx_execute", 10), makeToolResultLine("t1", 12, "ok", false)];
    const result = collectBashCallResults(lines).get("t1") as BashCallResult;
    assert.equal(result.resultText, "ok");
    assert.equal(result.isError, false);
});

test("test_collectBashCallResults_skips_a_call_record_with_no_timestamp", () => {
    const lines = [makeToolUseLine("t1", "Bash", undefined), makeToolResultLine("t1", 12, "ok", false)];
    assert.equal(collectBashCallResults(lines).size, 0);
});

test("test_isNeverRanResult_is_true_for_an_error_that_starts_with_a_listed_prefix", () => {
    assert.equal(isNeverRanResult(makeResult(true, "PreToolUse:Bash hook error: nope")), true);
    assert.equal(isNeverRanResult(makeResult(true, "<tool_use_error>Blocked: x")), true);
});

test("test_isNeverRanResult_is_true_for_a_ctx_execute_pyenv_python_command_not_found_error", () => {
    // Scenario: the ctx_execute result opens with an upgrade notice and uses "Exit code: 127".
    const resultText = "⚠️ context-mode v1.0.126 outdated → v1.0.168 available. Upgrade: /ctx-upgrade\n\nExit code: 127\n\nstdout:\n\n\nstderr:\npyenv: python: command not found\n\nThe `python' command exists in these Python versions:\n  3.14.3";
    assert.equal(isNeverRanResult(makeResult(true, resultText)), true);
});

test("test_isNeverRanResult_is_true_for_a_pyenv_python_command_not_found_error", () => {
    const resultText = "Exit code 127\npyenv: python: command not found\n\nThe `python' command exists in these Python versions:\n  3.14.3";
    assert.equal(isNeverRanResult(makeResult(true, resultText)), true);
});

test("test_isNeverRanResult_is_false_when_the_result_is_not_an_error", () => {
    assert.equal(isNeverRanResult(makeResult(false, "PreToolUse:Bash hook error: nope")), false);
});

test("test_isNeverRanResult_is_false_for_an_error_with_no_listed_prefix", () => {
    assert.equal(isNeverRanResult(makeResult(true, "Exit code 1")), false);
});

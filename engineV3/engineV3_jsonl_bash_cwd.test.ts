import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import type { JSONLLine } from "./engineV3.ts";
import { setBashCallCwdsToShellCwds } from "./engineV3_jsonl_bash_cwd.ts";

const ROOT = "/Users/me/repo";
const PLAYGROUND = "/Users/me/repo/playground";

function makeToolUseLine(toolUseId: string, toolName: string, cwd: string): JSONLLine {
    const block = { type: "tool_use", id: toolUseId, name: toolName, input: {}, caller: { type: "direct" } };
    return { type: "assistant", timestamp: new Date(0), cwd: new Path(cwd), message: { content: [block] } } as unknown as JSONLLine;
}

function makeToolResultLine(toolUseId: string, cwd: string | undefined): JSONLLine {
    const block = { type: "tool_result", tool_use_id: toolUseId, content: "ok", is_error: false };
    const cwdFields = cwd === undefined ? {} : { cwd: new Path(cwd) };
    return { type: "user", timestamp: new Date(0), ...cwdFields, message: { content: [block] } } as unknown as JSONLLine;
}

function getCwdText(line: JSONLLine): string {
    return (line.cwd as Path).toString();
}

test("test_first_bash_call_keeps_the_cwd_of_its_own_line", () => {
    // Scenario: a session's first Bash call has no earlier call, so its own line says where the shell starts.
    const firstCall = makeToolUseLine("t1", "Bash", ROOT);
    setBashCallCwdsToShellCwds([firstCall, makeToolResultLine("t1", ROOT)]);
    assert.equal(getCwdText(firstCall), ROOT);
});

test("test_second_bash_call_takes_the_cwd_of_the_first_calls_result_line", () => {
    // Scenario: the second call line says playground because a parallel session cd'd there, but this session's shell stayed in the root.
    const firstCall = makeToolUseLine("t1", "Bash", ROOT);
    const secondCall = makeToolUseLine("t2", "Bash", PLAYGROUND);
    setBashCallCwdsToShellCwds([firstCall, makeToolResultLine("t1", ROOT), secondCall, makeToolResultLine("t2", PLAYGROUND)]);
    assert.equal(getCwdText(secondCall), ROOT);
});

test("test_second_bash_call_in_the_same_turn_takes_the_cwd_of_the_first_calls_result_line", () => {
    // Scenario: both calls are written before the first result; the second runs after the first, which left the shell in playground.
    const firstCall = makeToolUseLine("t1", "Bash", ROOT);
    const secondCall = makeToolUseLine("t2", "Bash", ROOT);
    setBashCallCwdsToShellCwds([firstCall, secondCall, makeToolResultLine("t1", PLAYGROUND), makeToolResultLine("t2", PLAYGROUND)]);
    assert.equal(getCwdText(secondCall), PLAYGROUND);
});

test("test_bash_call_after_a_subagent_handback_keeps_the_cwd_of_its_own_line", () => {
    // Scenario: a resumed subagent starts a new shell, so the call after the handback ignores the shell folder from before.
    const firstCall = makeToolUseLine("t1", "Bash", ROOT);
    const handback = makeToolUseLine("t2", "SubagentHandback", ROOT);
    const resumedCall = makeToolUseLine("t3", "Bash", PLAYGROUND);
    setBashCallCwdsToShellCwds([firstCall, makeToolResultLine("t1", ROOT), handback, makeToolResultLine("t2", ROOT), resumedCall, makeToolResultLine("t3", PLAYGROUND)]);
    assert.equal(getCwdText(resumedCall), PLAYGROUND);
});

test("test_ctx_execute_call_keeps_its_cwd_and_does_not_move_the_shell", () => {
    // Scenario: a ctx_execute call between two Bash calls is not the shell, so the second Bash call still follows the first.
    const firstCall = makeToolUseLine("t1", "Bash", ROOT);
    const ctxCall = makeToolUseLine("t2", "mcp__plugin_context-mode_context-mode__ctx_execute", PLAYGROUND);
    const secondCall = makeToolUseLine("t3", "Bash", PLAYGROUND);
    setBashCallCwdsToShellCwds([firstCall, makeToolResultLine("t1", ROOT), ctxCall, makeToolResultLine("t2", PLAYGROUND), secondCall, makeToolResultLine("t3", PLAYGROUND)]);
    assert.equal(getCwdText(ctxCall), PLAYGROUND);
    assert.equal(getCwdText(secondCall), ROOT);
});

test("test_api_request_blob_line_does_not_change_which_call_is_previous", () => {
    // Scenario: a blob line repeats the first call after its result; it has no timestamp, so it is not a call.
    const firstCall = makeToolUseLine("t1", "Bash", ROOT);
    const blobLine = { ...makeToolUseLine("t1", "Bash", PLAYGROUND), type: "api-request-blob", timestamp: undefined } as unknown as JSONLLine;
    const secondCall = makeToolUseLine("t2", "Bash", PLAYGROUND);
    setBashCallCwdsToShellCwds([firstCall, makeToolResultLine("t1", ROOT), blobLine, secondCall, makeToolResultLine("t2", PLAYGROUND)]);
    assert.equal(getCwdText(blobLine), PLAYGROUND);
    assert.equal(getCwdText(secondCall), ROOT);
});

test("test_throws_when_the_previous_bash_call_has_no_result_cwd", () => {
    // Scenario: the first call's result line carries no cwd, so the shell folder after it is unknown.
    const lines = [makeToolUseLine("t1", "Bash", ROOT), makeToolResultLine("t1", undefined), makeToolUseLine("t2", "Bash", PLAYGROUND)];
    assert.throws(() => setBashCallCwdsToShellCwds(lines), /no result cwd/);
});

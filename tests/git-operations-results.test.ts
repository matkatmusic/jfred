// Split from git-operations.test.ts for the 250-line cap; scenario-document extractions stay there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findGitOperations } from "../src/reconstruction_git_operations.ts";
import { BlockType, GitOperationKind, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

function buildBashToolUseRecord(command: string, toolUseId: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_use, id: toolUseId, name: ToolName.Bash, input: { command }, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// A user record carrying the tool_result for `toolUseId`, whose content is the command's printed
// output text (the shape git commit's `[branch hash] message` summary arrives in).
function buildToolResultRecord(toolUseId: string, resultText: string, timestamp: string): TranscriptRecord {
    return {
        type: RecordType.user,
        timestamp: new Date(timestamp),
        message: { content: [{ type: BlockType.tool_result, tool_use_id: toolUseId, content: resultText, is_error: false }] },
    } as unknown as TranscriptRecord;
}

test("test_commit_operations_carry_result_hash", () => {
    // Scenario: a successful `git commit`'s tool_result text carries the short hash in git's
    // `[branch hash] message` summary line; findGitOperations must capture that hash on the
    // commit's GitOperation as resultHash so the viewer can render `GIT COMMIT [hash]`.
    // Steps:
    // build one assistant record running `git commit -m "fix: x"` under block id toolu_hash1.
    // build one user record whose tool_result for toolu_hash1 prints git's summary line.
    const records = [
        buildBashToolUseRecord('git commit -m "fix: x"', "toolu_hash1", "2026-01-01T00:00:01Z"),
        buildToolResultRecord("toolu_hash1", "[master 4fa08d2] fix: x\n 1 file changed, 1 insertion(+)", "2026-01-01T00:00:02Z"),
    ];
    // extract the git operations from the records.
    const operations = findGitOperations(records);
    // assert exactly one operation came back and it is the commit.
    assert.equal(operations.length, 1);
    assert.equal(operations[0]!.kind, GitOperationKind.commit);
    // assert the commit operation carries the short hash from its result's summary line.
    assert.equal(operations[0]!.resultHash, "4fa08d2");
});

test("test_commit_operations_carry_result_hash_from_bare_hex_token", () => {
    // Scenario: scenario captures pipe git's summary away and echo their own line containing the
    // short hash (s84 prints `ok 928eaa9`); with no `[branch hash]` line present, a whole-word
    // 7-to-40-char hex token in the commit's own result is still unambiguously the hash.
    // Steps:
    // build one assistant record running `git commit -m "baseline"` under block id toolu_hash2.
    const records = [
        buildBashToolUseRecord('git commit -m "baseline"', "toolu_hash2", "2026-01-01T00:00:01Z"),
        // build one user record whose tool_result prints the scenario-style `ok <hash>` line.
        buildToolResultRecord("toolu_hash2", "ok 928eaa9", "2026-01-01T00:00:02Z"),
    ];
    // extract the git operations from the records.
    const operations = findGitOperations(records);
    // assert the commit operation carries the hash found as a bare hex token.
    assert.equal(operations.length, 1);
    assert.equal(operations[0]!.kind, GitOperationKind.commit);
    assert.equal(operations[0]!.resultHash, "928eaa9");
});

test("test_commit_operations_without_result_output_have_no_hash", () => {
    // Scenario: a commit whose tool_result text carries no `[branch hash]` summary line (e.g.
    // output was piped away) yields a commit operation with NO resultHash — the viewer's pill
    // falls back to a dash.
    // Steps:
    // build the same commit record, but a tool_result whose text has no `[branch hash]` line.
    const records = [
        buildBashToolUseRecord('git commit -m "fix: x"', "toolu_hash1", "2026-01-01T00:00:01Z"),
        buildToolResultRecord("toolu_hash1", "ok done", "2026-01-01T00:00:02Z"),
    ];
    // extract the git operations from the records.
    const operations = findGitOperations(records);
    // assert the commit came back with resultHash undefined.
    assert.equal(operations.length, 1);
    assert.equal(operations[0]!.kind, GitOperationKind.commit);
    assert.equal(operations[0]!.resultHash, undefined);
});

test("test_compound_command_yields_one_operation_per_git_segment", () => {
    // Scenario: one Bash call chains two git commands with `&&` (task 89). Each segment gets its
    // own operation — the commit must not vanish into the add, the add's detail must not carry
    // the compound tail, and only the commit segment reads the shared tool_result's hash.
    const records = [
        buildBashToolUseRecord('git add a.py && git commit -m "fix: x"', "toolu_compound1", "2026-01-01T00:00:01Z"),
        buildToolResultRecord("toolu_compound1", "[master 4fa08d2] fix: x\n 2 files changed", "2026-01-01T00:00:02Z"),
    ];
    const operations = findGitOperations(records);
    // assert one operation per segment, in command order.
    assert.deepEqual(
        operations.map((operation) => operation.kind),
        [GitOperationKind.add, GitOperationKind.commit],
    );
    // assert each detail is the segment's own (no compound tail pollution).
    assert.deepEqual(
        operations.map((operation) => operation.detail),
        ["a.py", "fix: x"],
    );
    // assert each operation carries its own segment as its command text.
    assert.deepEqual(
        operations.map((operation) => operation.command),
        ["git add a.py", 'git commit -m "fix: x"'],
    );
    // assert the commit segment found the hash in the shared tool_result; the add carries none.
    assert.equal(operations[0]!.resultHash, undefined);
    assert.equal(operations[1]!.resultHash, "4fa08d2");
});

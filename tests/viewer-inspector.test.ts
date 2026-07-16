// Tests for the inspector's pure helpers (webapp/inspector.ts — plain ES module, DOM-free):
// backup-time lookup for blob names and tool-flow navigation targets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findBackupTimeForBlob, findToolNavigationTargets } from "../webapp/inspector-links.ts";

test("test_findBackupTimeForBlob_returns_the_snapshot_entrys_backup_time", () => {
    // Scenario: a file-history-snapshot record maps tracked files to backup blobs with times.
    const record = {
        type: "file-history-snapshot",
        snapshot: {
            trackedFileBackups: {
                "inventory.py": { backupFileName: "5436e8e9f917cd04@v2", version: 2, backupTime: "2026-06-27T04:29:36.586Z" },
                "rename_inv.py": { backupFileName: null, version: 1, backupTime: "2026-06-27T04:29:44.173Z" },
            },
        },
    };
    // look up the blob's entry.
    const backupTime = findBackupTimeForBlob(record, "5436e8e9f917cd04@v2");
    // its backupTime comes back.
    assert.equal(backupTime, "2026-06-27T04:29:36.586Z");
});

test("test_findBackupTimeForBlob_returns_undefined_for_records_without_that_blob", () => {
    // Scenario: ordinary records carry no trackedFileBackups (and null backup names never match).
    // Steps: look the blob up in a plain message record and in a snapshot without it.
    assert.equal(findBackupTimeForBlob({ type: "user", message: {} }, "abc@v2"), undefined);
    assert.equal(findBackupTimeForBlob({ snapshot: { trackedFileBackups: { "a.py": { backupFileName: null } } } }, "abc@v2"), undefined);
});

// -------------------- inspector tool-flow navigation --------------------

// A minimal transcript mirroring s40 lines 59-62: a Bash tool_use, its PreToolUse hook
// attachment (twice — the first is the jump target), and the tool_result linking back via
// sourceToolAssistantUUID.
const TOOL_FLOW_RAW_LINES = [
    JSON.stringify({ type: "assistant", uuid: "record-59", message: { content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: {} }] } }),
    JSON.stringify({ type: "attachment", uuid: "record-60", attachment: { type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "toolu_x" } }),
    JSON.stringify({ type: "attachment", uuid: "record-61", attachment: { type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "toolu_x" } }),
    JSON.stringify({ type: "user", uuid: "record-62", sourceToolAssistantUUID: "record-59", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x" }] } }),
];

test("test_findToolNavigationTargets_resolves_hook_and_result_lines", () => {
    // Scenario: an inspected assistant tool_use record offers jumps to its PreToolUse hook line
    // (the FIRST record whose toolUseID names the tool_use id) and to its tool-result line (the
    // record whose sourceToolAssistantUUID names the assistant record).
    // Steps:
    // resolve navigation targets for the tool_use record.
    const targets = findToolNavigationTargets(TOOL_FLOW_RAW_LINES, JSON.parse(TOOL_FLOW_RAW_LINES[0]!));
    assert.ok(targets !== undefined);
    // the hook jump lands on the first hook line, not the duplicate after it.
    assert.equal(targets!.hookLine, 1);
    // the result jump lands on the sourceToolAssistantUUID line.
    assert.equal(targets!.resultLine, 3);
});

test("test_findToolNavigationTargets_ignores_non_tool_records", () => {
    // Scenario: records that call no tool (prompts, hooks, results themselves) offer no tool-flow
    // navigation.
    // Steps:
    // resolve targets for the user tool_result record; assert none.
    const targets = findToolNavigationTargets(TOOL_FLOW_RAW_LINES, JSON.parse(TOOL_FLOW_RAW_LINES[3]!));
    assert.equal(targets, undefined);
});

test("test_findToolNavigationTargets_falls_back_to_tool_use_id_for_results", () => {
    // Scenario: a tool_result record without sourceToolAssistantUUID (older transcripts) is still
    // found through its tool_result block's tool_use_id.
    // Steps:
    // rebuild the transcript without the sourceToolAssistantUUID property and resolve again.
    const rawLines = [...TOOL_FLOW_RAW_LINES];
    rawLines[3] = JSON.stringify({ type: "user", uuid: "record-62", message: { content: [{ type: "tool_result", tool_use_id: "toolu_x" }] } });
    const targets = findToolNavigationTargets(rawLines, JSON.parse(rawLines[0]!));
    assert.equal(targets!.resultLine, 3);
});

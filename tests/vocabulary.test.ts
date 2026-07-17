import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RecordType,
    BlockType,
    ToolName,
    AttachmentPayloadType,
    EventKind,
    Verdict,
    KNOWN_VERDICTS,
    ENVELOPE_ID_KEYS,
    ENVELOPE_KEYS,
} from "../src/structures/vocabulary.ts";

test("test_record_type_enum_holds_the_s1_wire_strings", () => {
    // Scenario: RecordType's member values are the record-type wire strings seen
    // so far — the 10 from s1 (recon/06-s1-vocabulary.md), queue-operation added by
    // s4-overwrite-file, agent-name + custom-title observed in real
    // ~/.claude/projects sessions the viewer opens (discriminant-only session meta),
    // and fork-context-ref observed opening real subagents/agent-*.jsonl transcripts
    // (2026-07-05 corpus audit of ~/Programming/jot-recovery/claude-data/projects).
    // file-history-delta added by the s87 capture (newer CC per-file backup pointer).
    assert.deepEqual(Object.values(RecordType).sort(), [
        "agent-name",
        "ai-title",
        "assistant",
        "attachment",
        "bridge-session",
        "custom-title",
        "file-history-delta",
        "file-history-snapshot",
        "fork-context-ref",
        "last-prompt",
        "mode",
        "permission-mode",
        "queue-operation",
        "system",
        "user",
    ]);
});

test("test_block_type_enum_holds_the_s1_wire_strings", () => {
    // Scenario: BlockType's member values are the 4 content-block wire strings
    // from s1, plus `image` (a pasted image in a real user turn).
    assert.deepEqual(Object.values(BlockType).sort(), [
        "image",
        "text",
        "thinking",
        "tool_result",
        "tool_use",
    ]);
});

test("test_tool_name_enum_holds_the_observed_wire_strings", () => {
    // Scenario: ToolName's member values are the tool names used so far —
    // Bash/Write (s1) plus Read/Edit (s2-move-file), plus the context-mode MCP
    // execution tools (s37 runs a rename script through ctx_execute).
    assert.deepEqual(Object.values(ToolName).sort(), [
        "Bash",
        "Edit",
        "Read",
        "Write",
        "mcp__plugin_context-mode_context-mode__ctx_batch_execute",
        "mcp__plugin_context-mode_context-mode__ctx_execute",
        "mcp__plugin_context-mode_context-mode__ctx_execute_file",
    ]);
});

test("test_attachment_payload_type_enum_holds_the_observed_wire_strings", () => {
    // Scenario: AttachmentPayloadType's member values are the payload kinds seen
    // so far — the 6 from s1, the 3 added by s2-move-file, edited_text_file added
    // by s15-user-edit-then-conv-rewind, and the 5 added by the all-scenario
    // re-run (command_permissions, hook_cancelled, selected_lines_in_ide from
    // s1/s2/s19; file, invoked_skills from the compact-session scenarios).
    assert.deepEqual(Object.values(AttachmentPayloadType).sort(), [
        "agent_listing_delta",
        "command_permissions",
        "deferred_tools_delta",
        "diagnostics",
        "edited_text_file",
        "file",
        "hook_additional_context",
        "hook_cancelled",
        "hook_success",
        "hook_system_message",
        "invoked_skills",
        "opened_file_in_ide",
        "selected_lines_in_ide",
        "skill_listing",
        "task_reminder",
    ]);
});

test("test_event_kind_enum_holds_the_observed_wire_strings", () => {
    // Scenario: EventKind's member values are the engine's evidence kinds seen so
    // far — write/delete (s1), edit/rename (s2), copy (s3), overwrite (s4),
    // append (s5), plus user-edit added by s15-user-edit-then-conv-rewind (a
    // user's out-of-band disk edit, captured as an edited_text_file attachment), plus
    // script-execution added by s37-script-rename-driver-back-and-forth-mcp (the post-execution
    // state of a recorded script run, replayed and validated).
    assert.deepEqual(Object.values(EventKind).sort(), [
        "append",
        "copy",
        "delete",
        "edit",
        "overwrite",
        "rename",
        "script-execution",
        "user-edit",
        "write",
    ]);
});

test("test_known_verdicts_contains_every_verdict_member", () => {
    // Scenario: KNOWN_VERDICTS is the runtime mirror of the Verdict enum — it holds one entry per
    // member (including the two anchors `ignore` and `scriptExecution`) and nothing more.
    assert.equal(KNOWN_VERDICTS.length, Object.values(Verdict).length);
    assert.ok(KNOWN_VERDICTS.includes(Verdict.ignore));
    assert.ok(KNOWN_VERDICTS.includes(Verdict.scriptExecution));
});

test("test_envelope_key_groups_mirror_the_envelope_field_names", () => {
    // Scenario: the shared envelope field-key groups are the runtime mirror of
    // EnvelopeBase — the id subset and the full envelope field set.
    assert.deepEqual([...ENVELOPE_ID_KEYS], ["uuid", "parentUuid", "sessionId"]);
    assert.deepEqual([...ENVELOPE_KEYS], [
        "type",
        "uuid",
        "parentUuid",
        "sessionId",
        "isSidechain",
        "cwd",
        "gitBranch",
        "version",
        "timestamp",
        "userType",
        "entrypoint",
        "slug",
    ]);
});


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
    // Scenario: RecordType holds every record-type wire string seen so far, from s1 through the s87 capture.
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
    // Scenario: BlockType holds the 4 s1 wire strings, `image`, and the Advisor tool's two blocks.
    assert.deepEqual(Object.values(BlockType).sort(), [
        "advisor_tool_result",
        "image",
        "server_tool_use",
        "text",
        "thinking",
        "tool_result",
        "tool_use",
    ]);
});

test("test_tool_name_enum_holds_the_observed_wire_strings", () => {
    // Scenario: ToolName holds the tool names used so far: Bash, Write, Read, Edit, and the context-mode execution tools.
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
    // Scenario: AttachmentPayloadType holds every attachment payload kind seen so far across the scenarios.
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
    // Scenario: EventKind holds the engine's evidence kinds seen so far, including user-edit and script-execution.
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
    // Scenario: KNOWN_VERDICTS mirrors the Verdict enum with one entry per member, anchors `ignore` and `scriptExecution` included.
    assert.equal(KNOWN_VERDICTS.length, Object.values(Verdict).length);
    assert.ok(KNOWN_VERDICTS.includes(Verdict.ignore));
    assert.ok(KNOWN_VERDICTS.includes(Verdict.scriptExecution));
});

test("test_envelope_key_groups_mirror_the_envelope_field_names", () => {
    // Scenario: the envelope field-key groups mirror EnvelopeBase: the id subset and the full field set.
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


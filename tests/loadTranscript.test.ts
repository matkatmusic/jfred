import { test } from "node:test";
import assert from "node:assert/strict";
import {
    loadTranscript,
    parseTranscriptLine,
    UnmodeledFieldError,
} from "../src/parse/loadTranscript.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { S1_JSONL, S2_JSONL, S19_JSONL, S32_JSONL } from "./fixtures.ts";
import { readNonEmptyLines } from "./utilities.ts";

// Every (record type, top-level field) pair the 2026-07-05 corpus audit of real
// ~/Programming/jot-recovery/claude-data/projects transcripts surfaced as unmodeled
// (re-verified 2026-07-07). Sample values mirror the observed wire shapes; each field
// cites one evidence file:line from the corpus. None is scenario-reproducible: the
// fields ride only on subagent runs, API retries, Esc-interrupts, permission denials,
// queued prompts, image pastes, web-bridge sessions, or version-transient spellings.
const OBSERVED_REAL_SESSION_FIELD_SAMPLES: Record<string, Record<string, unknown>> = {
    [RecordType.assistant]: {
        // cb96ea5f…/subagents/agent-ad5fe73d9db452bf5.jsonl:3
        agentId: "ad5fe73d9db452bf5",
        // cb96ea5f…/subagents/agent-ad5fe73d9db452bf5.jsonl:3
        attributionAgent: "Explore",
        // 9a9af9cb-d140-40b3-809c-30cc63c35923.jsonl:29 (snake_case sessionId duplicate, CC 2.1.198+)
        session_id: "9a9af9cb-d140-40b3-809c-30cc63c35923",
        // 85b520ce-b996-476c-90e2-02be4a08454d.jsonl:18 (CC 2.1.154/2.1.173 only)
        sessionKind: "bg",
        // d431a258-c288-456a-8c1f-ca8f0d47551e.jsonl:102
        isApiErrorMessage: false,
        // 4ae7521a-b92d-4585-b978-c378fbf3e303.jsonl:1142
        error: "unknown",
        // 55ff70b5-9957-409a-a682-46152538e9b2.jsonl:689
        apiErrorStatus: 429,
        // scenarios/executed/s87-demo-composite/1b61dfe4….jsonl:24 (reasoning-effort level)
        effort: "high",
    },
    [RecordType.user]: {
        // cb96ea5f…/subagents/agent-ad5fe73d9db452bf5.jsonl:1
        agentId: "ad5fe73d9db452bf5",
        // 9a9af9cb-d140-40b3-809c-30cc63c35923.jsonl:42
        session_id: "9a9af9cb-d140-40b3-809c-30cc63c35923",
        // 85b520ce-b996-476c-90e2-02be4a08454d.jsonl:13
        sessionKind: "bg",
        // a2e85f70-56e7-4f99-b119-08140636ed3f.jsonl:383 (Esc-interrupted response)
        interruptedMessageId: "msg_01BCsmGz4r3AsWaaTQaAJmE6",
        // 7157c2a2-13f0-4539-ac05-362e8a30447c.jsonl:314
        sourceToolUseID: "toolu_01T766HZotKAGmhPwJRJFcJL",
        // 89a97751-46d0-4eff-a138-12e78e225bc9.jsonl:256 (denied permission prompt)
        toolDenialKind: "user-rejected",
        // 3689e384-a88e-45ca-89f6-c071a0f3b04b.jsonl:550
        imagePasteIds: [1],
        // f7ad55b4-dab8-43df-a818-577dc514ea67.jsonl:746 (queued prompt)
        queuePriority: "later",
    },
    [RecordType.attachment]: {
        // cb96ea5f…/subagents/agent-ad5fe73d9db452bf5.jsonl:2
        agentId: "ad5fe73d9db452bf5",
        // 9a9af9cb-d140-40b3-809c-30cc63c35923.jsonl:31
        session_id: "9a9af9cb-d140-40b3-809c-30cc63c35923",
        // 85b520ce-b996-476c-90e2-02be4a08454d.jsonl:15
        sessionKind: "bg",
    },
    [RecordType.system]: {
        // b5f72b99-9e83-47ea-a4fe-45d8bbedbb46.jsonl:26 (subtype bridge_status)
        url: "https://claude.ai/code/session_01UY6cbNkU1YsiHzZGtdKhbo",
        // 0f13baeb-e90d-420b-b946-7892241e5fc4.jsonl:121 (subtype turn_duration)
        pendingBackgroundAgentCount: 1,
        // 5eb74e0f-bbb0-43b8-b7ee-db92f171ee40.jsonl:13 (CC 2.1.181-197 spelling of
        // the modeled preventedContinuation)
        preventContinuation: true,
        // 9a9af9cb-d140-40b3-809c-30cc63c35923.jsonl:33
        session_id: "9a9af9cb-d140-40b3-809c-30cc63c35923",
        // a618e07c-e990-4183-9f08-95380cfb2ab8.jsonl:699 (subtype api_error, CC ≤2.1.179)
        error: { type: null, cause: { code: "ECONNRESET" } },
        retryInMs: 591.9455101772054,
        retryAttempt: 1,
        maxRetries: 10,
        cause: { code: "ECONNRESET" },
        // 85b520ce-b996-476c-90e2-02be4a08454d.jsonl:11
        sessionKind: "bg",
    },
};

test("test_s1_jsonl_parses_into_known_typed_records", () => {
    // Scenario: loading the whole s1 transcript yields only typed records — no
    // unknown record type and no unmodeled top-level key falls through.
    // Steps:
    // load every record of the s1 JSONL through the gate.
    const records = loadTranscript(S1_JSONL);
    // every non-empty line becomes a typed record — none dropped, none thrown.
    assert.equal(records.length, readNonEmptyLines(S1_JSONL).length);
    // every record carries a known record type string.
    for (const record of records) {
        assert.equal(typeof record.type, "string");
    }
});

test("test_s2_jsonl_parses_into_known_typed_records", () => {
    // Scenario: the whole s2-move-file transcript passes the field-level gate —
    // its new vocabulary (Read/Edit tools, 3 new attachment kinds, the user
    // isMeta key) is modeled, so nothing falls through as unknown/unmodeled.
    // Steps:
    // load every record of the s2 JSONL through the gate.
    const records = loadTranscript(S2_JSONL);
    // every non-empty line becomes a typed record — none dropped, none thrown.
    assert.equal(records.length, readNonEmptyLines(S2_JSONL).length);
    // every record carries a known record type string.
    for (const record of records) {
        assert.equal(typeof record.type, "string");
    }
});

test("test_s32_jsonl_parses_with_mcp_attribution_keys", () => {
    // Scenario: the s32 transcript runs its rename script through the context-mode MCP
    // sandbox. The MCP-invoking assistant records carry two novel top-level keys
    // (attributionMcpServer / attributionMcpTool). The field-gate must model them, not throw.
    // Steps:
    // load every record of the s32 JSONL through the gate (throws UnmodeledFieldError at HEAD).
    const records = loadTranscript(S32_JSONL);
    // every non-empty line becomes a typed record — none dropped, none thrown.
    assert.equal(records.length, readNonEmptyLines(S32_JSONL).length);
    // the assistant turns that issued an MCP tool call carry the two attribution keys.
    const withAttribution = records.filter(
        (record) => "attributionMcpServer" in record || "attributionMcpTool" in record,
    );
    // at least one MCP-invoking assistant turn is present.
    assert.ok(withAttribution.length > 0);
    // each carries the context-mode server; the tool name is run-specific
    // (the re-run carries both ctx_execute and ctx_execute_file), so assert
    // only that it is present.
    for (const record of withAttribution) {
        assert.equal(
            (record as { attributionMcpServer?: string }).attributionMcpServer,
            "plugin:context-mode:context-mode",
        );
        assert.equal(
            typeof (record as { attributionMcpTool?: string }).attributionMcpTool,
            "string",
        );
    }
});

test("test_s19_rerun_jsonl_parses_with_attribution_plugin_and_skill_keys", () => {
    // Scenario: the re-run s19 transcript was produced by a newer Claude Code that emits two novel
    // top-level keys on assistant turns issued under an active skill (attributionPlugin /
    // attributionSkill, same `attribution*` family as the MCP keys). The field-gate must model them.
    // Steps:
    // load every record of the re-run s19 JSONL through the gate (throws UnmodeledFieldError at HEAD).
    const records = loadTranscript(S19_JSONL);
    // every non-empty line becomes a typed record — none dropped, none thrown.
    assert.equal(records.length, readNonEmptyLines(S19_JSONL).length);
    // the assistant turns issued under a skill carry both attribution keys.
    const withAttribution = records.filter(
        (record) => "attributionSkill" in record || "attributionPlugin" in record,
    );
    // at least one such assistant turn is present.
    assert.ok(withAttribution.length > 0);
    for (const record of withAttribution) {
        assert.equal(
            (record as { attributionSkill?: string }).attributionSkill,
            "ponytail:ponytail",
        );
        assert.equal(
            (record as { attributionPlugin?: string }).attributionPlugin,
            "ponytail",
        );
    }
});

test("test_parseTranscriptLine_accepts_fields_observed_in_real_sessions", () => {
    // Scenario: real transcripts carry metadata fields the scenario captures never
    // produced (see OBSERVED_REAL_SESSION_FIELD_SAMPLES). The field gate must model
    // every observed (type, field) pair instead of tolerating it via the viewer bypass.
    for (const [recordType, fields] of Object.entries(OBSERVED_REAL_SESSION_FIELD_SAMPLES)) {
        for (const [fieldName, sampleValue] of Object.entries(fields)) {
            // build a minimal record of that type carrying just the observed field.
            const line = JSON.stringify({ type: recordType, [fieldName]: sampleValue });
            // parsing it through the strict gate succeeds (throws UnmodeledFieldError at HEAD).
            const record = parseTranscriptLine(line);
            assert.equal(record.type, recordType);
        }
    }
});

test("test_parseTranscriptLine_accepts_fork_context_ref_records", () => {
    // Scenario: real subagent transcripts (subagents/agent-*.jsonl) open with a
    // fork-context-ref record naming the forked agent and its parent session
    // (2026-07-05 corpus audit; e.g. 540aa36b…/subagents/agent-a4363e1e9ecf2042d.jsonl:1).
    // Steps:
    // build the observed record shape — type + agentId/parentSessionId/parentLastUuid/contextLength.
    const line = JSON.stringify({
        type: RecordType.forkContextRef,
        agentId: "a4363e1e9ecf2042d",
        parentSessionId: "540aa36b-e985-453c-84ca-5f2688367174",
        parentLastUuid: "3a72e1c6-5971-452c-a731-dbff3cae6f90",
        contextLength: 29,
    });
    // parsing it through the strict gate succeeds (throws UnknownRecordTypeError at HEAD).
    const record = parseTranscriptLine(line);
    assert.equal(record.type, RecordType.forkContextRef);
});

test("test_parseTranscriptLine_rejects_unmodeled_top_level_key", () => {
    // Scenario: a record carrying a top-level key absent from the s1 field
    // inventory is rejected loudly (field-level fog-of-war guard).
    // Steps:
    // build a valid mode record with one extra, unmodeled key.
    const line = JSON.stringify({
        type: "mode",
        sessionId: "s",
        mode: "normal",
        bogusKey: 1,
    });
    // parsing it through the gate throws.
    assert.throws(() => parseTranscriptLine(line), UnmodeledFieldError);
});


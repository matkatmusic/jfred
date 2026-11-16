// The field-level fog-of-war gate (src/parse/recordKeys.ts): every observed real-session (type, field) pair is modeled, and an unmodeled key still throws. Split from loadTranscript.test.ts (250-line cap).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptLine } from "../src/parse/loadTranscript.ts";
import { UnmodeledFieldError } from "../src/parse/recordKeys.ts";
import { RecordType } from "../src/structures/vocabulary.ts";

// Every (record type, top-level field) pair the 2026-07-05 corpus audit of real ~/Programming/jot-recovery/claude-data/projects transcripts surfaced as unmodeled (re-verified 2026-07-07). Sample values mirror the observed wire shapes; each field cites one evidence file:line from the corpus. None is scenario-reproducible: the fields ride only on subagent runs, API retries, Esc-interrupts, permission denials, queued prompts, image pastes, web-bridge sessions, or version-transient spellings.
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
        // 2b1644e3…/subagents/agent-a30d93510c209e336.jsonl:20
        advisorModel: "claude-fable-5-1",
        // 2b1644e3…/subagents/agent-a30d93510c209e336.jsonl:20
        apiBlockIndex: 0,
        // 70acab65…/subagents/agent-aefcad428a13e0a09.jsonl:130
        apiError: "connection_failed",
        // 7d31cfda-fb91-4f61-ba61-7031cb5484e2.jsonl:716
        isAbortedMidStream: true,
        // 2b1644e3…/subagents/agent-a30d93510c209e336.jsonl:20
        perTurnEffort: "high",
        // 2b1644e3…/subagents/agent-a30d93510c209e336.jsonl:20
        promptCacheRequested: "5m",
        // 94093865…/subagents/agent-ac498c2fcc17a9892.jsonl:16
        requestedModel: "claude-sonnet-5-5",
        // 2b1644e3…/subagents/agent-a30d93510c209e336.jsonl:20
        requestRef: "7c3d9a52-4e81-4b06-8f27-d5a1c0e93b64",
        // 2fa36f95…/subagents/agent-a1b06c9dba139ae95.jsonl:20
        serverClassifierRequest: "9f4e2b17-6a30-4c58-b1d9-3e7a85c20f46",
        // 70acab65…/subagents/agent-aefcad428a13e0a09.jsonl:130
        streamCutCause: "stale_connection",
        // 2b1644e3…/subagents/agent-a30d93510c209e336.jsonl:33
        thinkingDisplay: "updates",
        // 94093865-0449-5315-b401-1fdee7fe4d1a.jsonl:51 (playground folder)
        thinkingDurationMs: 1333,
        // 70acab65-8467-404e-8848-e7478d987dba.jsonl:1401
        toolInputStreamMs: 1600,
        // 94093865-0449-5315-b401-1fdee7fe4d1a.jsonl:31 (playground folder)
        wireIngestContext: { toolu_01Xq7RtLm4Zc9HbNw2KsVdEa: { cwd: "/Users/example/project" } },
        // 8f9bc86c-c7fc-5521-bdca-8a74c3d0f483.jsonl:32 (playground folder; same-shape stand-in for the command text)
        wireToolInputs: { toolu_01Pj8WsDy3Fg6TnQc5MvBhUr: { command: "ls", description: "List files" } },
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
        // 8f9bc86c…/subagents/agent-aa885f7b2bfbc7f84.jsonl:3 (playground folder)
        rendered: [{ content: "<system-reminder>stand-in text</system-reminder>" }],
        // 94093865-0449-5315-b401-1fdee7fe4d1a/subagents/agent-ac498c2fcc17a9892.jsonl:13 (playground folder)
        renderedBesideToolResult: true,
        // 6e01d3f7-e389-41bb-ae21-a9da73263097.jsonl:250
        renderedInHumanTurn: [{ content: "<system-reminder>stand-in text</system-reminder>" }, { content: "stand-in text" }],
        // 6e01d3f7-e389-41bb-ae21-a9da73263097.jsonl:8
        renderedRole: "system",
    },
    [RecordType.system]: {
        // b5f72b99-9e83-47ea-a4fe-45d8bbedbb46.jsonl:26 (subtype bridge_status)
        url: "https://claude.ai/code/session_01UY6cbNkU1YsiHzZGtdKhbo",
        // 0f13baeb-e90d-420b-b946-7892241e5fc4.jsonl:121 (subtype turn_duration)
        pendingBackgroundAgentCount: 1,
        // 5eb74e0f-bbb0-43b8-b7ee-db92f171ee40.jsonl:13 (CC 2.1.181-197 spelling of the modeled preventedContinuation)
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
    [RecordType.bridgeSession]: {
        // 6e01d3f7-e389-41bb-ae21-a9da73263097.jsonl:7 (playground folder; stand-in uuid)
        ownerAccountUuid: "11111111-2222-4333-8444-555555555555",
        // 24366073-dc22-42eb-a4fe-73006a20752f.jsonl:6 (playground folder; stand-in uuid)
        ownerOrganizationUuid: "66666666-7777-4888-8999-000000000000",
    },
    [RecordType.lastPrompt]: {
        // 8f9bc86c-c7fc-5521-bdca-8a74c3d0f483.jsonl:96 (playground folder; stand-in uuid)
        cutUuid: "11111111-2222-4333-8444-555555555555",
        // 8f9bc86c-c7fc-5521-bdca-8a74c3d0f483.jsonl:96
        explicit: true,
        // 8f9bc86c-c7fc-5521-bdca-8a74c3d0f483.jsonl:96
        rewound: true,
    },
    [RecordType.queueOperation]: {
        // 94093865-0449-5315-b401-1fdee7fe4d1a.jsonl:97 (playground folder; stand-in uuid)
        commandUuid: "11111111-2222-4333-8444-555555555555",
        // 8f9bc86c-c7fc-5521-bdca-8a74c3d0f483.jsonl:81 (playground folder; stand-in uuid)
        deliveryId: "66666666-7777-4888-8999-000000000000",
        // 6e01d3f7-e389-41bb-ae21-a9da73263097.jsonl:249
        reason: "absorbed_mid_turn",
    },
};

test("test_parseTranscriptLine_accepts_fields_observed_in_real_sessions", () => {
    // Scenario: real transcripts carry metadata fields the scenario captures never produced (see OBSERVED_REAL_SESSION_FIELD_SAMPLES). The field gate must model every observed (type, field) pair instead of tolerating it via the viewer bypass.
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
    // Scenario: real subagent transcripts (subagents/agent-*.jsonl) open with a fork-context-ref record naming the forked agent and its parent session (2026-07-05 corpus audit; e.g. 540aa36b…/subagents/agent-a4363e1e9ecf2042d.jsonl:1).  Steps: build the observed record shape — type + agentId/parentSessionId/parentLastUuid/contextLength.
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
    // Scenario: a record carrying a top-level key absent from the s1 field inventory is rejected loudly (field-level fog-of-war guard).  Steps: build a valid mode record with one extra, unmodeled key.
    const line = JSON.stringify({
        type: "mode",
        sessionId: "s",
        mode: "normal",
        bogusKey: 1,
    });
    // parsing it through the gate throws.
    assert.throws(() => parseTranscriptLine(line), UnmodeledFieldError);
});

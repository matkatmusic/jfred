import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTranscript } from "../src/parse/loadTranscript.ts";
import { S1_JSONL, S2_JSONL, S19_JSONL, S32_JSONL } from "./fixtures.ts";
import { readNonEmptyLines } from "./utilities.ts";

test("test_s1_jsonl_parses_into_known_typed_records", () => {
    // Scenario: loading the whole s1 transcript yields only typed records — no
    // unknown record type and no unmodeled top-level key falls through.
    // Steps:
    // load every record of the s1 JSONL through the gate.
    const { records } = loadTranscript(S1_JSONL);
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
    const { records } = loadTranscript(S2_JSONL);
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
    const { records } = loadTranscript(S32_JSONL);
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
    const { records } = loadTranscript(S19_JSONL);
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

// The parseTranscriptLine field-gate tests (observed real-session fields, fork-context-ref,
// unmodeled-key rejection) live in tests/recordKeys.test.ts (250-line cap split).


// Document-shape extensions consumed by the revision-timeline view, exercised end-to-end through the s84/s85 multi-JSONL project fixtures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjectDocument } from "../src/viewer_api.ts";
import { findSessionTitles } from "../src/reconstruction_json.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { S45_JSONL, S84_JSONL_PATHS, S85_JSONL_PATHS } from "./fixtures.ts";

// Built once — the s84 unified document is expensive (three transcripts) and read-only here.
const s84Document = buildProjectDocument(S84_JSONL_PATHS, undefined);

test("test_conversation_messages_carry_session_id", () => {
    // One distinct sessionId per JSONL.
    const distinctIds = new Set(s84Document.messages.map((message) => message.sessionId?.toString()));
    assert.equal(distinctIds.size, 3);
    for (const message of s84Document.messages) {
        assert.ok(message.sessionId instanceof Uuid);
    }
});

test("test_step_snapshots_carry_session_id", () => {
    // Synthetic changeIds match no tool_use block and stay unattributed — those are the steps whose changedPaths resolves to [].
    const distinctIds = new Set(
        s84Document.steps.map((step) => step.sessionId?.toString()).filter((id) => id !== undefined),
    );
    assert.ok(distinctIds.size >= 2);
    for (const step of s84Document.steps) {
        if (step.changedPaths.length > 0) {
            assert.ok(step.sessionId instanceof Uuid);
        }
    }
});

test("test_document_exposes_rewound_file_histories", () => {
    // s45 is the purpose-built rewind-abandoned-branch scenario; s84 has no rewinds.
    const s45Document = buildProjectDocument([new Path(S45_JSONL)], undefined);
    assert.ok(s45Document.rewoundFilesTouched.length >= 1);
    for (const history of s45Document.rewoundFilesTouched) {
        assert.ok(history.target instanceof Path);
        assert.ok(history.revisions.length >= 1);
    }
    assert.ok(s45Document.filesTouched.length >= 1);
    assert.ok(Array.isArray(s84Document.rewoundFilesTouched));
});

test("test_messages_and_tool_calls_carry_is_orphaned", () => {
    // isOrphaned lets the timeline dim the whole abandoned exchange, not just file-mutating turns.
    const s45Document = buildProjectDocument([new Path(S45_JSONL)], undefined);
    const orphanedMessages = s45Document.messages.filter((message) => message.isOrphaned);
    assert.equal(orphanedMessages.length, 4);
    assert.ok(orphanedMessages.some((message) => message.role === RecordType.user));
    assert.ok(orphanedMessages.some((message) => message.role === RecordType.assistant));
    const orphanedCalls = s45Document.toolCalls.filter((call) => call.isOrphaned);
    assert.equal(orphanedCalls.length, 1);
    assert.ok(s45Document.toolCalls.some((call) => !call.isOrphaned));
    assert.equal(s84Document.messages.filter((message) => message.isOrphaned).length, 0);
    assert.equal(s84Document.toolCalls.filter((call) => call.isOrphaned).length, 0);
});

test("test_document_lists_commit_markers_for_s85", () => {
    // Commit markers come from a pure transcript scan — no exec gate, no on-disk repo.
    const s85Document = buildProjectDocument(S85_JSONL_PATHS, undefined);
    assert.ok(s85Document.commitMarkers.length >= 1);
    for (const marker of s85Document.commitMarkers) {
        assert.ok(marker.timestamp instanceof Date);
        assert.ok(marker.sessionId instanceof Uuid);
    }
    assert.ok(s84Document.commitMarkers.length >= 1);
});

test("test_session_titles_map_custom_title_records", () => {
    // Session-start markers show the user-chosen title when a `custom-title` record exists.
    const records = [
        { type: "custom-title", customTitle: "tackle TASKS.md 1", sessionId: new Uuid("aaaa1111-0000-4000-8000-000000000001") },
        { type: "custom-title", customTitle: "fork-style-mockup", sessionId: new Uuid("bbbb2222-0000-4000-8000-000000000002") },
        { type: "user", sessionId: new Uuid("aaaa1111-0000-4000-8000-000000000001") },
    ];
    const titles = findSessionTitles(records as never);
    assert.deepEqual(titles, {
        "aaaa1111-0000-4000-8000-000000000001": "tackle TASKS.md 1",
        "bbbb2222-0000-4000-8000-000000000002": "fork-style-mockup",
    });
});

test("test_document_carries_session_titles", () => {
    // Scenario captures have no custom-title records, so the map is empty and markers fall back to id.
    assert.deepEqual(s84Document.sessionTitles, {});
});


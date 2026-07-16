// Document-shape extensions consumed by the revision-timeline view: session attribution on
// messages and steps, rewound (orphaned) file histories, and git-commit markers. These tests own
// the unified multi-JSONL document end-to-end via the s84/s85 project fixtures.

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
    // Scenario: a unified multi-JSONL document attributes each message to its source session.
    // Steps:
    // build the unified document for s84's three JSONLs.
    // collect the distinct sessionId values across document.messages.
    // assert there are exactly 3 distinct ids (one per JSONL).
    // assert every message's sessionId is an instance of Uuid.
    const distinctIds = new Set(s84Document.messages.map((message) => message.sessionId?.toString()));
    assert.equal(distinctIds.size, 3);
    for (const message of s84Document.messages) {
        assert.ok(message.sessionId instanceof Uuid);
    }
});

test("test_step_snapshots_carry_session_id", () => {
    // Scenario: every reconstruction step reports the session whose tool call produced it.
    // Synthetic changeIds (re-stamped / off-branch revisions) match no tool_use block and stay
    // unattributed — those are exactly the steps whose changedPaths hint resolves to [].
    // Steps:
    // build the unified document for s84's three JSONLs.
    // assert every step that resolves changedPaths carries a Uuid sessionId.
    // assert at least 2 distinct sessionIds appear across steps (multi-agent scenario has
    // changes from more than one session).
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
    // Scenario: the document exposes rewound (abandoned-branch) file histories so the timeline
    // can mark orphaned steps; surviving filesTouched is unaffected.
    // Steps:
    // build the document for s45 (the purpose-built rewind-abandoned-branch scenario).
    // assert rewoundFilesTouched holds at least one FileHistory with revisions.
    // assert surviving filesTouched is still populated.
    // assert s84 (no rewinds) reports the field as an array.
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
    // Scenario: the engine stamps per-record branch membership on the wire — every message and
    // toolCall on a rewound (abandoned) conversation branch carries isOrphaned:true, so the
    // timeline can dim the WHOLE abandoned exchange (user prompts and tool rows included), not
    // just the file-mutating agent turns the old snapshot proxy caught.
    // Steps:
    // build the document for s45 (the purpose-built rewind-abandoned-branch scenario).
    const s45Document = buildProjectDocument([new Path(S45_JSONL)], undefined);
    // s45's abandoned branch carries 4 messages: at least one user prompt and one assistant reply.
    const orphanedMessages = s45Document.messages.filter((message) => message.isOrphaned);
    assert.equal(orphanedMessages.length, 4);
    assert.ok(orphanedMessages.some((message) => message.role === RecordType.user));
    assert.ok(orphanedMessages.some((message) => message.role === RecordType.assistant));
    // exactly one tool call ran on the abandoned branch; surviving calls stay unflagged.
    const orphanedCalls = s45Document.toolCalls.filter((call) => call.isOrphaned);
    assert.equal(orphanedCalls.length, 1);
    assert.ok(s45Document.toolCalls.some((call) => !call.isOrphaned));
    // s84 (three interleaved sessions, zero rewinds) flags nothing.
    assert.equal(s84Document.messages.filter((message) => message.isOrphaned).length, 0);
    assert.equal(s84Document.toolCalls.filter((call) => call.isOrphaned).length, 0);
});

test("test_document_lists_commit_markers_for_s85", () => {
    // Scenario: the document lists when `git commit` ran (pure transcript scan — no exec gate,
    // no on-disk repo), so the timeline can render commit nodes as pick hard-stops.
    // Steps:
    // build s85's document (its transcript records two `git -C … commit` calls).
    // assert commitMarkers is non-empty and each marker has a Date timestamp and a Uuid sessionId.
    // assert s84's document also reports its baseline commits (its transcripts contain 3).
    const s85Document = buildProjectDocument(S85_JSONL_PATHS, undefined);
    assert.ok(s85Document.commitMarkers.length >= 1);
    for (const marker of s85Document.commitMarkers) {
        assert.ok(marker.timestamp instanceof Date);
        assert.ok(marker.sessionId instanceof Uuid);
    }
    assert.ok(s84Document.commitMarkers.length >= 1);
});

test("test_session_titles_map_custom_title_records", () => {
    // Scenario: users name sessions; each JSONL carries a `custom-title` record
    // ({type:"custom-title", customTitle, sessionId}). findSessionTitles maps every
    // session id to its title so the timeline's session-start markers can show it.
    // Steps:
    // build two custom-title records for two sessions plus one unrelated record.
    const records = [
        { type: "custom-title", customTitle: "tackle TASKS.md 1", sessionId: new Uuid("aaaa1111-0000-4000-8000-000000000001") },
        { type: "custom-title", customTitle: "fork-style-mockup", sessionId: new Uuid("bbbb2222-0000-4000-8000-000000000002") },
        { type: "user", sessionId: new Uuid("aaaa1111-0000-4000-8000-000000000001") },
    ];
    // map the titles.
    const titles = findSessionTitles(records as never);
    // each session id resolves to its own title; nothing else leaks in.
    assert.deepEqual(titles, {
        "aaaa1111-0000-4000-8000-000000000001": "tackle TASKS.md 1",
        "bbbb2222-0000-4000-8000-000000000002": "fork-style-mockup",
    });
});

test("test_document_carries_session_titles", () => {
    // Scenario: the wire document ships sessionTitles; scenario captures have no
    // custom-title records, so s84's map is empty (the marker falls back to id-only).
    assert.deepEqual(s84Document.sessionTitles, {});
});


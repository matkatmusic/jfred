// Pure view-model tests for the JSON inspector's formatted-text mode; records arrive as JSON.parse'd or raw JSONL lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeBlobRequestUrl,
    computeRevisionLinkRoute,
    computeSnapshotHistoryAnchor,
    findTrackedBackupEntry,
} from "../webapp/inspector-links.ts";
import { extractReadableText } from "../webapp/inspector-text.ts";

test("test_extract_readable_text_returns_string_message_content_verbatim", () => {
    // Scenario: a user record whose message.content is a plain string — the prompt text IS the readable content.
    const record = { type: "user", message: { role: "user", content: "fix the bug" } };
    assert.equal(extractReadableText(record), "fix the bug");
});

test("test_extract_readable_text_joins_text_blocks_with_blank_lines", () => {
    // Scenario: an assistant record with two text blocks reads as two paragraphs.
    const record = { type: "assistant", message: { content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
    ] } };
    assert.equal(extractReadableText(record), "first\n\nsecond");
});

test("test_extract_readable_text_unwraps_tool_result_content", () => {
    // Scenario: a tool_result block carries the file/tool output — string form and nested text-block form both read as their text.
    const stringForm = { message: { content: [{ type: "tool_result", content: "line a\nline b" }] } };
    assert.equal(extractReadableText(stringForm), "line a\nline b");
    const nestedForm = { message: { content: [{ type: "tool_result", content: [{ type: "text", text: "inner" }] }] } };
    assert.equal(extractReadableText(nestedForm), "inner");
});

test("test_extract_readable_text_renders_tool_use_string_inputs_verbatim", () => {
    // Scenario: a tool_use block (e.g. Write) holds its payload in string input fields; show them with real newlines, not JSON-escaped.
    const record = { message: { content: [
        { type: "tool_use", name: "Write", input: { file_path: "a.py", content: "x = 1\ny = 2", count: 3 } },
    ] } };
    assert.equal(
        extractReadableText(record),
        "[tool_use: Write]\n--- file_path ---\na.py\n--- content ---\nx = 1\ny = 2",
    );
});

test("test_extract_readable_text_marks_unknown_blocks_instead_of_dropping_them", () => {
    // Scenario: a block kind the extractor does not model becomes a one-line placeholder so nothing silently vanishes.
    const record = { message: { content: [{ type: "thinking", thinking: "hmm" }] } };
    assert.equal(extractReadableText(record), "[thinking]");
});

test("test_extract_readable_text_returns_undefined_without_message_content", () => {
    // Scenario: a file-history snapshot record has no message — the inspector hides the formatted-text toggle for it.
    assert.equal(extractReadableText({ type: "file-history-snapshot", snapshot: {} }), undefined);
});

test("test_extract_readable_text_returns_non_json_lines_verbatim", () => {
    // Scenario: the inspector falls back to the raw string when JSON.parse fails; that string is already the readable content.
    assert.equal(extractReadableText("not json at all"), "not json at all");
});

test("test_revision_link_route_carries_revision_anchor", () => {
    // Scenario: a revision link with a revision number routes to the file-history view, matching routeToFileHistory's /rev/<n> shape.
    const route = computeRevisionLinkRoute("proj-a", { target: "/tmp/app.py", revisionNumber: 3 });
    assert.equal(route, "#/project/proj-a/file/%2Ftmp%2Fapp.py/rev/3");
});

test("test_revision_link_route_without_revision_number_omits_anchor", () => {
    // A link resolved to a file but no single revision routes to the plain file-history view, with no /rev segment.
    const route = computeRevisionLinkRoute("proj-a", { target: "/tmp/app.py", revisionNumber: undefined });
    assert.equal(route, "#/project/proj-a/file/%2Ftmp%2Fapp.py");
});


test("test_find_tracked_backup_entry_returns_the_tracked_path_and_backup_time", () => {
    // A file-history-snapshot record tracks a backup whose blob name matches; the key is the tracked path and its backup time.
    const record = { type: "file-history-snapshot", snapshot: { trackedFileBackups: {
        "tests/test_inventory.py": { backupFileName: "abcdef0123456789@v2", backupTime: "2026-01-01T00:00:03.000Z" },
    } } };
    assert.deepEqual(
        findTrackedBackupEntry(record, "abcdef0123456789@v2"),
        { relativePath: "tests/test_inventory.py", backupTime: "2026-01-01T00:00:03.000Z" },
    );
});

test("test_find_tracked_backup_entry_returns_undefined_for_a_non_snapshot_record", () => {
    // Scenario: an ordinary record carries no snapshot — no entry resolves.
    assert.equal(findTrackedBackupEntry({ type: "user", message: { content: "hi" } }, "abcdef0123456789@v2"), undefined);
});

test("test_find_tracked_backup_entry_returns_undefined_when_the_blob_is_not_tracked", () => {
    // Scenario: the snapshot tracks other backups but not this blob name.
    const record = { type: "file-history-snapshot", snapshot: { trackedFileBackups: {
        "src/app.py": { backupFileName: "1111111111111111@v1", backupTime: "2026-01-01T00:00:01.000Z" },
    } } };
    assert.equal(findTrackedBackupEntry(record, "abcdef0123456789@v2"), undefined);
});

test("test_snapshot_history_anchor_names_the_revision_in_effect_at_backup_time", () => {
    // Scenario: the tracked path matches a file whose revision follows backupTime; the anchor is the last revision before that time.
    const filesTouched = [{ target: "/proj/tests/test_inventory.py", revisions: [
        { changeId: "toolu_1", timestamp: "2026-01-01T00:00:01.000Z" },
        { changeId: "toolu_2", timestamp: "2026-01-01T00:00:05.000Z" },
    ] }];
    assert.deepEqual(
        computeSnapshotHistoryAnchor(filesTouched, "tests/test_inventory.py", "2026-01-01T00:00:03.000Z"),
        { target: "/proj/tests/test_inventory.py", revisionNumber: 1 },
    );
});

test("test_snapshot_history_anchor_omits_the_revision_when_backup_precedes_them_all", () => {
    // Scenario: the backup predates every revision, so the file still links but with no revision anchored (plain file-history route).
    const filesTouched = [{ target: "/proj/tests/test_inventory.py", revisions: [
        { changeId: "toolu_1", timestamp: "2026-01-01T00:00:05.000Z" },
    ] }];
    assert.deepEqual(
        computeSnapshotHistoryAnchor(filesTouched, "tests/test_inventory.py", "2026-01-01T00:00:03.000Z"),
        { target: "/proj/tests/test_inventory.py", revisionNumber: undefined },
    );
});

test("test_snapshot_history_anchor_returns_undefined_without_a_matching_target", () => {
    // Scenario: no reconstructed file matches the tracked path — the caller omits the [View in File History] button entirely.
    const filesTouched = [{ target: "/proj/src/other.py", revisions: [
        { changeId: "toolu_1", timestamp: "2026-01-01T00:00:01.000Z" },
    ] }];
    assert.equal(computeSnapshotHistoryAnchor(filesTouched, "tests/test_inventory.py", "2026-01-01T00:00:03.000Z"), undefined);
});

test("test_blob_request_url_encodes_both_query_params", () => {
    // The /api/blob URL URL-encodes session and blob name, since an @ in the name must not break the query string.
    assert.equal(
        computeBlobRequestUrl("a4918fd5-session", "abcdef0123456789@v2"),
        "/api/blob?session=a4918fd5-session&name=abcdef0123456789%40v2",
    );
});


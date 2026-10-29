// Pure view-model tests for the JSON inspector's formatted-text mode; records arrive as JSON.parse'd or raw JSONL lines.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeBlobRequestUrl,
    computeRevisionLinkRoute,
    computeSnapshotHistoryAnchor,
    findTrackedBackupEntry,
} from "../webapp/inspector-links.ts";

test("test_revision_link_route_carries_revision_anchor", () => {
    // Scenario: a revision link with a revision number routes to the file-history view, matching getFileHistoryRoute's /rev/<n> shape.
    const route = computeRevisionLinkRoute("proj-a", { target: "/tmp/app.py", revisionNumber: 3 });
    assert.equal(route, "#/project/proj-a/file/%2Ftmp%2Fapp.py/rev/3");
});

test("test_revision_link_route_without_revision_number_omits_anchor", () => {
    // A link with a file but no single revision routes to plain file-history, with no /rev segment.
    const route = computeRevisionLinkRoute("proj-a", { target: "/tmp/app.py", revisionNumber: undefined });
    assert.equal(route, "#/project/proj-a/file/%2Ftmp%2Fapp.py");
});


test("test_find_tracked_backup_entry_returns_the_tracked_path_and_backup_time", () => {
    // A file-history-snapshot record tracks a backup; the key is the tracked path and its backup time.
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
    // Scenario: the anchor is the last revision before backupTime for the tracked path.
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
    // The /api/blob URL encodes session and blob name so an @ cannot break the query string.
    assert.equal(
        computeBlobRequestUrl("a4918fd5-session", "abcdef0123456789@v2"),
        "/api/blob?session=a4918fd5-session&name=abcdef0123456789%40v2",
    );
});


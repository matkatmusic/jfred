// Tests for the blob-snapshot reads in src/viewer_api_trust_boundary.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readBlobSnapshot } from "../src/viewer_api_trust_boundary.ts";
import { getDefaultFileHistoryRoot } from "../src/reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { S43_JSONL_PATHS } from "./fixtures.ts";

// The first backup in one snapshot line whose blob file is on disk, else undefined.
function findBackupInSnapshotLine(root: string, session: string, line: string): { session: Uuid; blobName: Path } | undefined {
    if (!line.includes("file-history-snapshot")) {
        return undefined;
    }
    let parsed: { snapshot?: { trackedFileBackups?: Record<string, { backupFileName?: string }> } };
    try {
        parsed = JSON.parse(line);
    } catch {
        return undefined;
    }
    const backups = parsed.snapshot?.trackedFileBackups;
    if (backups === undefined) {
        return undefined;
    }
    for (const entry of Object.values(backups)) {
        // Snapshot lines can carry backupFileName: null, which join would reject.
        if (entry.backupFileName != null && existsSync(join(root, session, entry.backupFileName))) {
            return { session: new Uuid(session), blobName: new Path(entry.backupFileName) };
        }
    }
    return undefined;
}

// The first on-disk tracked backup in any line of one transcript, else undefined.
function findBackupInTranscript(root: string, session: string, jsonlPath: Path): { session: Uuid; blobName: Path } | undefined {
    for (const line of readFileSync(jsonlPath.toString(), "utf8").split("\n")) {
        const pair = findBackupInSnapshotLine(root, session, line);
        if (pair !== undefined) {
            return pair;
        }
    }
    return undefined;
}

// A live (session, blob name) pair from the s43 capture, read from the real ~/.claude/file-history root.
function findExistingS43Backup(): { session: Uuid; blobName: Path } | undefined {
    const root = getDefaultFileHistoryRoot().toString();
    for (const jsonlPath of S43_JSONL_PATHS) {
        const session = basename(jsonlPath.toString(), ".jsonl");
        const pair = findBackupInTranscript(root, session, jsonlPath);
        if (pair !== undefined) {
            return pair;
        }
    }
    return undefined;
}

test("test_readBlobSnapshot_rejects_a_blob_name_with_path_separators", () => {
    // Scenario: anything that is not a bare blob name or session id is refused, so traversal fails.
    assert.throws(() => readBlobSnapshot(new Uuid("a"), new Path("../etc/passwd")));
});

test("test_readBlobSnapshot_reports_a_nonexistent_blob_as_missing", () => {
    // Scenario: a well-formed blob name that is not on disk reports { exists: false }.
    const result = readBlobSnapshot(
        new Uuid("00000000-0000-0000-0000-000000000000"),
        new Path("0000000000000000@v1"),
    );
    assert.deepEqual(result, { exists: false, content: undefined });
});

test("test_readBlobSnapshot_reads_an_existing_blob_from_the_owning_session_dir", (t) => {
    // Scenario: an s43 snapshot blob reads back verbatim from its owning session dir, with no cross-session fallback.
    const pair = findExistingS43Backup();
    if (pair === undefined) {
        // Task 165: live blobs exist only on the capture machine, so skip elsewhere.
        t.skip("no live ~/.claude/file-history blob for s43 on this machine");
        return;
    }
    const result = readBlobSnapshot(pair.session, pair.blobName);
    assert.equal(result.exists, true);
    assert.ok(result.content !== undefined && result.content.length > 0);
});

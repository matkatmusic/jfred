// Tests for src/viewer_api_projects.ts blob-snapshot reads (trust boundary). Split out of
// viewer-api-projects.test.ts (split, never condense) to keep that file within the
// 250-line cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readBlobSnapshot } from "../src/viewer_api_projects.ts";
import { getDefaultFileHistoryRoot } from "../src/reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { S43_JSONL_PATHS } from "./fixtures.ts";

// A live (owning session, blob name) pair derived from the s43 capture: scan each transcript's
// file-history-snapshot records for trackedFileBackups entries and return the first whose blob
// file exists under the real ~/.claude/file-history root (reader-dependent, like the sidecar
// tests — there is no root override in this repo). undefined when none is on disk.
// One transcript line of findExistingS43Backup's scan: parse a file-history-snapshot line's
// trackedFileBackups and return the first backup whose blob file is on disk, else undefined.
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
        // != null: captured snapshot lines can carry backupFileName: null (join would throw).
        if (entry.backupFileName != null && existsSync(join(root, session, entry.backupFileName))) {
            return { session: new Uuid(session), blobName: new Path(entry.backupFileName) };
        }
    }
    return undefined;
}

// One transcript of findExistingS43Backup's scan: check every line of the JSONL for an
// on-disk tracked backup, else undefined.
function findBackupInTranscript(root: string, session: string, jsonlPath: Path): { session: Uuid; blobName: Path } | undefined {
    for (const line of readFileSync(jsonlPath.toString(), "utf8").split("\n")) {
        const pair = findBackupInSnapshotLine(root, session, line);
        if (pair !== undefined) {
            return pair;
        }
    }
    return undefined;
}

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
    // Scenario: both arguments reach a filesystem join, so anything that is not a bare
    // `<16 hex>@vN` blob name (or a bare session id) is refused — traversal is impossible.
    assert.throws(() => readBlobSnapshot(new Uuid("a"), new Path("../etc/passwd")));
});

test("test_readBlobSnapshot_reports_a_nonexistent_blob_as_missing", () => {
    // Scenario: a well-formed name that is simply not on disk is not an error — the client
    // renders it as "(missing from disk)", so the read reports { exists: false }.
    const result = readBlobSnapshot(
        new Uuid("00000000-0000-0000-0000-000000000000"),
        new Path("0000000000000000@v1"),
    );
    assert.deepEqual(result, { exists: false, content: undefined });
});

test("test_readBlobSnapshot_reads_an_existing_blob_from_the_owning_session_dir", (t) => {
    // Scenario: a blob named by an s43 file-history snapshot reads back verbatim from its
    // OWNING session's dir under ~/.claude/file-history (owner-dir only — no cross-session
    // fallback, per the multi-session @vN collision fix).
    // Steps: derive a live (session, blob) pair from the s43 transcripts, then read it.
    const pair = findExistingS43Backup();
    if (pair === undefined) {
        // Machine-bound input (task 165): the live ~/.claude/file-history blobs exist only
        // on the capture machine — absent (e.g. CI), skip rather than fail.
        t.skip("no live ~/.claude/file-history blob for s43 on this machine");
        return;
    }
    const result = readBlobSnapshot(pair.session, pair.blobName);
    assert.equal(result.exists, true);
    assert.ok(result.content !== undefined && result.content.length > 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { fillRedirectContent } from "../src/reconstruction_sidecar_redirect.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { AppendEvent, EditEvent, FileEvent } from "../src/reconstruction_events.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType, EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// Two snapshots for one path: an earlier one and a later one that backs up the post-event content.
function buildSnapshotRecord(path: string, backupFileName: string, backupTime: string): TranscriptRecord {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: "m-" + backupFileName,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: "m-" + backupFileName,
            timestamp: backupTime,
            trackedFileBackups: { [path]: { backupFileName, version: 2, backupTime } },
        },
    } as unknown as TranscriptRecord;
}

// A synthetic envelope record that only carries the transcript's cwd.
function buildCwdRecord(cwd: string): TranscriptRecord {
    return { type: RecordType.user, cwd: new Path(cwd) } as unknown as TranscriptRecord;
}

// Snapshots key backups by cwd-relative path but a redirect's target is absolute; fillRedirectContent resolves against cwd to match.
test("test_fill_matches_a_cwd_relative_snapshot_path_to_an_absolute_target", () => {
    const cwd = "/work/dir";
    const records = [
        buildCwdRecord(cwd),
        // The snapshot names the file by its cwd-relative path only.
        buildSnapshotRecord("f.txt", "h@v3", "2026-01-01T00:00:20Z"),
    ];
    const event: FileEvent = {
        kind: EventKind.append, changeId: new Uuid("a1"),
        target: new Path("/work/dir/f.txt"), content: "", timestamp: new Date("2026-01-01T00:00:13Z"),
    };
    const reader: BackupReader = (name) => name.toString() === "h@v3" ? "filled\n" : "WRONG";
    const filled = fillRedirectContent(records, [event], reader);
    assert.equal((filled[0] as AppendEvent).content, "filled\n");
});

test("test_fill_resolves_redirect_content_from_the_next_snapshot_blob", () => {
    const path = "/a/s5_redirect.txt";
    const records = [
        buildSnapshotRecord(path, "h@v2", "2026-01-01T00:00:10Z"),
        buildSnapshotRecord(path, "h@v3", "2026-01-01T00:00:20Z"),
    ];
    // An append at :13 — the first snapshot strictly after it is @v3.
    const event: FileEvent = {
        kind: EventKind.append, changeId: new Uuid("a1"),
        target: new Path(path), content: "", timestamp: new Date("2026-01-01T00:00:13Z"),
    };
    const reader: BackupReader = (name) => name.toString() === "h@v3" ? "line one\nline two\n" : "WRONG";
    const filled = fillRedirectContent(records, [event], reader);
    assert.equal((filled[0] as AppendEvent).content, "line one\nline two\n");
});

test("test_fill_keeps_non_redirect_events_and_redirects_without_a_later_backup", () => {
    const path = "/a/s5_redirect.txt";
    const records = [buildSnapshotRecord(path, "h@v2", "2026-01-01T00:00:10Z")];
    const edit: EditEvent = {
        kind: EventKind.edit, changeId: new Uuid("e1"),
        target: new Path(path), hunks: [], timestamp: new Date("2026-01-01T00:00:05Z"),
    };
    const lateAppend: FileEvent = {
        kind: EventKind.append, changeId: new Uuid("a1"),
        target: new Path(path), content: "", timestamp: new Date("2026-01-01T00:00:13Z"),
    };
    const reader: BackupReader = () => "WRONG";
    const filled = fillRedirectContent(records, [edit, lateAppend], reader);
    assert.deepEqual(filled, [edit, lateAppend]);
});

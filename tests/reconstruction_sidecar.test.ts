import { test } from "node:test";
import assert from "node:assert/strict";
import {
    backupSeedWriteFor,
    fillRedirectContent,
    seedEditBaseFromBackup,
} from "../src/reconstruction_sidecar.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { resolveAgainstCwd } from "../src/structures/path-resolve.ts";
import type { AppendEvent, EditEvent, FileEvent, WriteEvent } from "../src/reconstruction_engine.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
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

// Snapshots key their backups by the path relative to cwd; a redirect's target is absolute.
// fillRedirectContent resolves the snapshot path against cwd so the two match.
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

test("test_resolve_against_cwd_joins_relative_and_passes_absolute_through", () => {
    const cwd = new Path("/work/dir");
    assert.equal(resolveAgainstCwd(cwd, new Path("a.py")), "/work/dir/a.py");
    // Idempotent on absolute paths — this is why S2's absolute mv stays correct.
    assert.equal(resolveAgainstCwd(cwd, new Path("/abs/a.py")), "/abs/a.py");
});

// Hunks stay empty: the seed only inspects events[0].kind, never the hunks.
function buildEditEvent(target: string, when: string): EditEvent {
    return {
        kind: EventKind.edit, changeId: new Uuid("edit-1"),
        target: new Path(target), hunks: [], timestamp: new Date(when),
    };
}

// A branch-leading Edit has its creating Write off-branch, so the seed prepends the pre-edit backup
// as a synthetic Write and the Edit splices onto real lines instead of an empty base.
test("test_seed_prepends_a_write_base_from_the_at_or_before_backup", () => {
    const cwd = "/work/dir";
    const records = [
        buildCwdRecord(cwd),
        // The pre-edit backup, snapshotted BEFORE the edit (16:09:52 < 16:10:31).
        buildSnapshotRecord("scenario12.py", "bk@v2", "2026-01-01T16:09:52Z"),
    ];
    const edit = buildEditEvent("/work/dir/scenario12.py", "2026-01-01T16:10:31Z");
    const reader: BackupReader = (name) =>
        name.toString() === "bk@v2" ? "def add(a, b):\n    return a + b\n" : "WRONG";
    const seeded = seedEditBaseFromBackup(records, [edit], reader);
    assert.equal(seeded.length, 2);
    assert.equal(seeded[0]!.kind, EventKind.write);
    assert.equal((seeded[0] as WriteEvent).content, "def add(a, b):\n    return a + b\n");
    assert.equal(seeded[0]!.target.toString(), "/work/dir/scenario12.py");
    assert.equal(seeded[1]!.kind, EventKind.edit);
    assert.equal(seeded[1], edit);
});

// Every S1–S11 file starts with its creating Write, so the seed must be a no-op for them.
test("test_seed_passes_through_when_first_event_creates_the_file", () => {
    const records = [buildCwdRecord("/work/dir")];
    const write: WriteEvent = {
        kind: EventKind.write, changeId: new Uuid("w1"),
        target: new Path("/work/dir/a.py"), content: "x\n", timestamp: new Date("2026-01-01T16:09:00Z"),
    };
    const reader: BackupReader = () => "SHOULD NOT BE READ";
    const seeded = seedEditBaseFromBackup(records, [write], reader);
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0], write);
});

// With no backup at or before the edit there is no base to recover, so the genesis guard applies.
test("test_seed_passes_through_when_no_backup_precedes_the_edit", () => {
    const cwd = "/work/dir";
    const records = [
        buildCwdRecord(cwd),
        // The only backup is snapshotted AFTER the edit (16:11:00 > 16:10:31) — too late to seed it.
        buildSnapshotRecord("scenario12.py", "bk@v3", "2026-01-01T16:11:00Z"),
    ];
    const edit = buildEditEvent("/work/dir/scenario12.py", "2026-01-01T16:10:31Z");
    const reader: BackupReader = () => "SHOULD NOT BE READ";
    const seeded = seedEditBaseFromBackup(records, [edit], reader);
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0], edit);
});

// A backup just AFTER the edit is still a valid pre-edit base: in m6 the user edit and the edit
// consuming it share a turn, so the pre-edit snapshot lands ~22ms late.
test("test_seed_recovers_later_backup_when_includeAfter_true", () => {
    const cwd = "/work/dir";
    const records = [
        buildCwdRecord(cwd),
        // The only backup is snapshotted AFTER the edit (16:07:55.546 > 16:07:55.524) — the m6 case.
        buildSnapshotRecord("m6_derived.py", "after@v1", "2026-01-01T16:07:55.546Z"),
    ];
    const editWhen = new Date("2026-01-01T16:07:55.524Z");
    const reader: BackupReader = (name) =>
        name.toString() === "after@v1" ? "# derived version\nbase content\n" : "WRONG";
    const seed = backupSeedWriteFor(records, new Path("/work/dir/m6_derived.py"), editWhen, reader, true);
    assert.notEqual(seed, undefined);
    assert.equal(seed!.kind, EventKind.write);
    assert.equal(seed!.changeId.toString(), "after@v1");
    assert.equal((seed as WriteEvent).content, "# derived version\nbase content\n");
});

// The later-backup fallback must never override a valid at-or-before backup.
test("test_seed_prefers_at_or_before_over_later_when_both_exist", () => {
    const cwd = "/work/dir";
    const records = [
        buildCwdRecord(cwd),
        buildSnapshotRecord("m6_derived.py", "before@v1", "2026-01-01T16:07:50.000Z"),
        buildSnapshotRecord("m6_derived.py", "after@v2", "2026-01-01T16:07:55.546Z"),
    ];
    const editWhen = new Date("2026-01-01T16:07:55.524Z");
    const reader: BackupReader = (name) =>
        name.toString() === "before@v1" ? "pre-edit content\n" : "WRONG";
    const seed = backupSeedWriteFor(records, new Path("/work/dir/m6_derived.py"), editWhen, reader, true);
    assert.notEqual(seed, undefined);
    assert.equal(seed!.changeId.toString(), "before@v1");
    assert.equal((seed as WriteEvent).content, "pre-edit content\n");
});


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
    // The append targets the absolute path /work/dir/f.txt.
    const event: FileEvent = {
        kind: EventKind.append, changeId: new Uuid("a1"),
        target: new Path("/work/dir/f.txt"), content: "", timestamp: new Date("2026-01-01T00:00:13Z"),
    };
    const reader: BackupReader = (name) => name.toString() === "h@v3" ? "filled\n" : "WRONG";
    const filled = fillRedirectContent(records, [event], reader);
    // The cwd-relative snapshot resolved to the absolute target, so the content is filled.
    assert.equal((filled[0] as AppendEvent).content, "filled\n");
});

// fillRedirectContent resolves a redirect's content from the snapshot taken just after it.
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
    // The append now carries the post-append blob; a non-redirect event would be untouched.
    assert.equal((filled[0] as AppendEvent).content, "line one\nline two\n");
});

// resolveAgainstCwd joins a relative path onto cwd and leaves an absolute path unchanged.
test("test_resolve_against_cwd_joins_relative_and_passes_absolute_through", () => {
    // A relative path is joined onto the cwd.
    const cwd = new Path("/work/dir");
    assert.equal(resolveAgainstCwd(cwd, new Path("a.py")), "/work/dir/a.py");
    // An already-absolute path is returned unchanged (idempotent — why S2's absolute mv stays correct).
    assert.equal(resolveAgainstCwd(cwd, new Path("/abs/a.py")), "/abs/a.py");
});

// An Edit on `target` at `when`, with no hunks (the seed never inspects hunks — only events[0].kind).
function buildEditEvent(target: string, when: string): EditEvent {
    return {
        kind: EventKind.edit, changeId: new Uuid("edit-1"),
        target: new Path(target), hunks: [], timestamp: new Date(when),
    };
}

// When a file's first event on this branch is an Edit (its creating Write is off-branch), the seed
// recovers the pre-edit on-disk content from the file-history backup taken at or before the edit and
// prepends it as a synthetic Write, so the Edit splices onto real lines instead of an empty base.
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
    // A synthetic Write base is prepended ahead of the Edit.
    assert.equal(seeded.length, 2);
    assert.equal(seeded[0]!.kind, EventKind.write);
    assert.equal((seeded[0] as WriteEvent).content, "def add(a, b):\n    return a + b\n");
    assert.equal(seeded[0]!.target.toString(), "/work/dir/scenario12.py");
    // The original Edit is preserved, now second.
    assert.equal(seeded[1]!.kind, EventKind.edit);
    assert.equal(seeded[1], edit);
});

// A file whose first event already creates it (a Write here) needs no base — the events pass through
// unchanged (this is every S1–S11 file, so the seed must be a no-op for them).
test("test_seed_passes_through_when_first_event_creates_the_file", () => {
    const records = [buildCwdRecord("/work/dir")];
    const write: WriteEvent = {
        kind: EventKind.write, changeId: new Uuid("w1"),
        target: new Path("/work/dir/a.py"), content: "x\n", timestamp: new Date("2026-01-01T16:09:00Z"),
    };
    const reader: BackupReader = () => "SHOULD NOT BE READ";
    const seeded = seedEditBaseFromBackup(records, [write], reader);
    // Pass-through: just the Write, no prepended base.
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0], write);
});

// When the Edit's first event has no backup snapshotted at or before it (only a later one exists), the
// seed cannot recover a base, so it passes the events through unchanged (the genesis guard then applies).
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
    // Pass-through: just the Edit, no prepended base.
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0], edit);
});

// On the stale-edit reseed path (includeAfter=true), a backup snapshotted just AFTER the edit's
// tool-use time IS a valid pre-edit base: m6's user edit and the edit consuming it share one turn, so
// the pre-edit snapshot lands ~22ms after the edit record. backupSeedWriteFor must fall back to it.
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
    // With includeAfter=true the fallback fires and recovers the later snapshot as the seed base.
    const seed = backupSeedWriteFor(records, new Path("/work/dir/m6_derived.py"), editWhen, reader, true);
    // A synthetic Write is returned, its changeId is the after-backup blob name, content from the reader.
    assert.notEqual(seed, undefined);
    assert.equal(seed!.kind, EventKind.write);
    assert.equal(seed!.changeId.toString(), "after@v1");
    assert.equal((seed as WriteEvent).content, "# derived version\nbase content\n");
});

// When both an at-or-before AND a later backup exist, the `??` precedence must keep the at-or-before
// one — the fallback only fills the gap when no pre-edit backup exists; it never overrides a valid one.
test("test_seed_prefers_at_or_before_over_later_when_both_exist", () => {
    const cwd = "/work/dir";
    const records = [
        buildCwdRecord(cwd),
        // One backup BEFORE the edit and one AFTER it.
        buildSnapshotRecord("m6_derived.py", "before@v1", "2026-01-01T16:07:50.000Z"),
        buildSnapshotRecord("m6_derived.py", "after@v2", "2026-01-01T16:07:55.546Z"),
    ];
    const editWhen = new Date("2026-01-01T16:07:55.524Z");
    const reader: BackupReader = (name) =>
        name.toString() === "before@v1" ? "pre-edit content\n" : "WRONG";
    // includeAfter=true, but the at-or-before backup wins via `??`.
    const seed = backupSeedWriteFor(records, new Path("/work/dir/m6_derived.py"), editWhen, reader, true);
    // The seed is the BEFORE backup, not the later one.
    assert.notEqual(seed, undefined);
    assert.equal(seed!.changeId.toString(), "before@v1");
    assert.equal((seed as WriteEvent).content, "pre-edit content\n");
});


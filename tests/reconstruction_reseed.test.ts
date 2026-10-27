import { test } from "node:test";
import assert from "node:assert/strict";
import { insertStaleEditBaseSeeds } from "../src/reconstruction_reseed.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { EditEvent, FileEvent, WriteEvent } from "../src/reconstruction_events.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { EventKind, RecordType } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

// A file-history snapshot naming one backup blob for one path at one instant.
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

// Task 224: a reseed from an older backup must not move the event ladder backwards in time.
test("test_stale_edit_seed_never_lands_before_the_event_it_follows", () => {
    const cwd = "/work/dir";
    const target = "/work/dir/plate_cli.py";
    // The recovered backup is stamped earlier than the beacon write.
    const records = [
        buildCwdRecord(cwd),
        buildSnapshotRecord("plate_cli.py", "04b5333dde2392bd@v2", "2026-05-13T21:45:19.907Z"),
    ];
    // The backup holds the real pre-edit disk text.
    const backupContent = "hello\nworld\n";
    const reader: BackupReader = (name) =>
        name.toString() === "04b5333dde2392bd@v2" ? backupContent : "WRONG";
    // The gitBase beacon carries a blob that does not match the edit, so the base is stale.
    const beacon: WriteEvent = {
        kind: EventKind.write,
        changeId: new Uuid("gitBase:1156e75f"),
        target: new Path(target),
        content: "committed line one\ncommitted line two\n",
        timestamp: new Date("2026-05-14T03:06:21.000Z"),
    };
    // This edit splices onto the backup content, not the beacon.
    const edit: EditEvent = {
        kind: EventKind.edit,
        changeId: new Uuid("edit-1"),
        target: new Path(target),
        hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" hello", "-world", "+planet"] }],
        timestamp: new Date("2026-05-14T03:06:21.658Z"),
    };
    const lineage: FileEvent[] = [beacon, edit];

    // Splice the recovered backup in before the stale edit.
    const events = insertStaleEditBaseSeeds(records, lineage, reader);

    // A third event was spliced in: the backup blob.
    assert.equal(events.length, 3);
    assert.equal(events[1]!.changeId.toString(), "04b5333dde2392bd@v2");
    // Event times never decrease.
    for (let index = 1; index < events.length; index += 1) {
        assert.ok(
            events[index]!.timestamp.getTime() >= events[index - 1]!.timestamp.getTime(),
            `event ${index} (${events[index]!.timestamp.toISOString()}) precedes event ${index - 1} (${events[index - 1]!.timestamp.toISOString()})`,
        );
    }
});

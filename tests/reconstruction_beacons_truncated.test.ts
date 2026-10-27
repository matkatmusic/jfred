import { test } from "node:test";
import assert from "node:assert/strict";
import {
    appendTruncatedBeaconCompletion,
    isBeaconTruncated,
} from "../src/reconstruction_beacons_truncated.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { FileEvent, UserEditEvent } from "../src/reconstruction_events.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { EventKind, RecordType } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const TARGET = "/a/f.txt";

function buildBeacon(content: string): UserEditEvent {
    return { kind: EventKind.userEdit, changeId: new Uuid("u1"), target: new Path(TARGET), content, timestamp: new Date("2026-01-01T00:00:10Z") };
}

function buildSnapshotRecord(backupFileName: string, backupTime: string): TranscriptRecord {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: "m-" + backupFileName,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: "m-" + backupFileName,
            timestamp: backupTime,
            trackedFileBackups: { [TARGET]: { backupFileName, version: 2, backupTime } },
        },
    } as unknown as TranscriptRecord;
}

test("test_isBeaconTruncated_needs_a_backup_that_extends_the_beacon_with_more_lines", () => {
    const beacon = buildBeacon("a\nb");
    assert.equal(isBeaconTruncated(beacon, "a\nb\nc"), true);
    assert.equal(isBeaconTruncated(beacon, "a\nb"), false);
    assert.equal(isBeaconTruncated(beacon, "X\nb\nc"), false);
});

test("test_appendTruncatedBeaconCompletion_leaves_events_alone_when_the_last_is_not_a_user_edit", () => {
    const write: FileEvent = { kind: EventKind.write, changeId: new Uuid("w"), target: new Path(TARGET), content: "a", timestamp: new Date("2026-01-01T00:00:05Z") };
    const reader: BackupReader = () => "WRONG";
    const events = [write];
    assert.equal(appendTruncatedBeaconCompletion([], events, reader), events);
});

test("test_appendTruncatedBeaconCompletion_appends_the_backup_write_for_a_truncated_terminal_beacon", () => {
    const records = [buildSnapshotRecord("h@v2", "2026-01-01T00:00:20Z")];
    const reader: BackupReader = () => "a\nb\nc";
    const events: FileEvent[] = [buildBeacon("a\nb")];
    const result = appendTruncatedBeaconCompletion(records, events, reader);
    assert.equal(result.length, 2);
    assert.equal(result[1]!.kind, EventKind.write);
});

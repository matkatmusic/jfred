import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildBackupTimeline,
    findBackupAfter,
    findBackupAtOrBefore,
    findBackupPointAfter,
    findCwd,
} from "../src/reconstruction_backup_timeline.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { RecordType } from "../src/structures/vocabulary.ts";
import { Path } from "../src/structures/domain.ts";

const CWD = new Path("/work");
const TARGET = new Path("/work/f.txt");

function buildSnapshotRecord(backupFileName: string | null, backupTime: string): TranscriptRecord {
    return {
        type: RecordType.fileHistorySnapshot,
        messageId: "m-" + backupTime,
        isSnapshotUpdate: false,
        snapshot: {
            messageId: "m-" + backupTime,
            timestamp: backupTime,
            trackedFileBackups: { "f.txt": { backupFileName, version: 1, backupTime } },
        },
    } as unknown as TranscriptRecord;
}

function buildCwdRecord(): TranscriptRecord {
    return { type: RecordType.user, cwd: CWD } as unknown as TranscriptRecord;
}

// Out of time order on purpose: the timeline must sort ascending.
function buildRecords(): TranscriptRecord[] {
    return [
        buildCwdRecord(),
        buildSnapshotRecord("h@v3", "2026-01-01T00:00:30Z"),
        buildSnapshotRecord(null, "2026-01-01T00:00:10Z"),
        buildSnapshotRecord("h@v2", "2026-01-01T00:00:20Z"),
    ];
}

test("test_find_cwd_returns_the_first_record_cwd_or_undefined", () => {
    assert.equal(findCwd(buildRecords())?.toString(), "/work");
    assert.equal(findCwd([buildSnapshotRecord("h@v1", "2026-01-01T00:00:10Z")]), undefined);
});

test("test_timeline_sorts_points_ascending_by_backup_time", () => {
    const records = buildRecords();
    const timeline = buildBackupTimeline(records, findCwd(records));
    const times = timeline.get("/work/f.txt")!.map((point) => point.backupTime.toISOString());
    assert.deepEqual(times, [
        "2026-01-01T00:00:10.000Z",
        "2026-01-01T00:00:20.000Z",
        "2026-01-01T00:00:30.000Z",
    ]);
});

test("test_find_backup_after_skips_null_blobs_and_requires_strictly_later", () => {
    const records = buildRecords();
    const timeline = buildBackupTimeline(records, CWD);
    assert.equal(findBackupAfter(timeline, CWD, TARGET, new Date("2026-01-01T00:00:05Z"))?.toString(), "h@v2");
    assert.equal(findBackupAfter(timeline, CWD, TARGET, new Date("2026-01-01T00:00:20Z"))?.toString(), "h@v3");
    assert.equal(findBackupAfter(timeline, CWD, TARGET, new Date("2026-01-01T00:00:30Z")), undefined);
});

test("test_find_backup_point_after_returns_the_full_point", () => {
    const timeline = buildBackupTimeline(buildRecords(), CWD);
    const point = findBackupPointAfter(timeline, CWD, TARGET, new Date("2026-01-01T00:00:25Z"));
    assert.equal(point?.backupFileName?.toString(), "h@v3");
    assert.equal(point?.backupTime.toISOString(), "2026-01-01T00:00:30.000Z");
});

test("test_find_backup_at_or_before_returns_the_latest_non_null_point", () => {
    const timeline = buildBackupTimeline(buildRecords(), CWD);
    const exact = findBackupAtOrBefore(timeline, CWD, TARGET, new Date("2026-01-01T00:00:20Z"));
    assert.equal(exact?.backupFileName?.toString(), "h@v2");
    assert.equal(findBackupAtOrBefore(timeline, CWD, TARGET, new Date("2026-01-01T00:00:15Z")), undefined);
});

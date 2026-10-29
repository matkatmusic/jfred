import { test } from "node:test";
import assert from "node:assert/strict";
import {
    computeBracketMidpointTime,
    isBackupMatchingBeacon,
    isBackupWithinBound,
    isBeaconElided,
} from "../src/reconstruction_beacons_elided_match.ts";
import type { WriteEvent } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

function buildWrite(content: string, iso: string): WriteEvent {
    return { kind: EventKind.write, changeId: new Uuid("w"), target: new Path("/a.py"), content, timestamp: new Date(iso) };
}

test("test_isBeaconElided_is_false_for_a_contiguous_snippet_from_line_one", () => {
    const snippet = { lines: [{ lineNo: 1, text: "a" }, { lineNo: 2, text: "b" }], hasEllipsis: false };
    assert.equal(isBeaconElided(snippet), false);
});

test("test_isBeaconElided_is_true_for_a_gap_an_ellipsis_or_a_late_start", () => {
    assert.equal(isBeaconElided({ lines: [{ lineNo: 1, text: "a" }, { lineNo: 3, text: "c" }], hasEllipsis: false }), true);
    assert.equal(isBeaconElided({ lines: [{ lineNo: 1, text: "a" }], hasEllipsis: true }), true);
    assert.equal(isBeaconElided({ lines: [{ lineNo: 4, text: "d" }], hasEllipsis: false }), true);
});

test("test_isBackupMatchingBeacon_requires_a_longer_backup_with_every_visible_line_in_place", () => {
    const snippet = { lines: [{ lineNo: 1, text: "a" }, { lineNo: 3, text: "c" }], hasEllipsis: true };
    assert.equal(isBackupMatchingBeacon(snippet, "a\nb\nc\nd"), true);
    assert.equal(isBackupMatchingBeacon(snippet, "a\nb\nX\nd"), false);
    assert.equal(isBackupMatchingBeacon(snippet, "a\nb"), false);
});

test("test_isBackupWithinBound_rejects_only_backups_newer_than_the_bound", () => {
    const candidate = buildWrite("x", "2026-01-01T00:00:10Z");
    assert.equal(isBackupWithinBound(candidate, undefined), true);
    assert.equal(isBackupWithinBound(candidate, new Date("2026-01-01T00:00:10Z")), true);
    assert.equal(isBackupWithinBound(candidate, new Date("2026-01-01T00:00:09Z")), false);
});

test("test_computeBracketMidpointTime_averages_last_without_and_first_with", () => {
    const seed = buildWrite("new", "2026-01-01T00:00:30Z");
    const backups = [buildWrite("old", "2026-01-01T00:00:10Z"), buildWrite("new", "2026-01-01T00:00:30Z")];
    assert.equal(computeBracketMidpointTime(seed, backups).toISOString(), "2026-01-01T00:00:20.000Z");
});

test("test_computeBracketMidpointTime_returns_the_seed_time_when_no_backup_lacks_the_content", () => {
    const seed = buildWrite("new", "2026-01-01T00:00:30Z");
    assert.equal(computeBracketMidpointTime(seed, [seed]).toISOString(), "2026-01-01T00:00:30.000Z");
});

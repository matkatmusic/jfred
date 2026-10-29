import { test } from "node:test";
import assert from "node:assert/strict";
import { insertElidedBeaconSeeds } from "../src/reconstruction_beacons.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

test("test_insertElidedBeaconSeeds_passes_non_beacon_events_through_unchanged", () => {
    const write: FileEvent = { kind: EventKind.write, changeId: new Uuid("w"), target: new Path("/a/f.txt"), content: "a", timestamp: new Date("2026-01-01T00:00:05Z") };
    const reader: BackupReader = () => "WRONG";
    const result = insertElidedBeaconSeeds([], [write], reader);
    assert.deepEqual(result, [write]);
});

test("test_insertElidedBeaconSeeds_keeps_a_beacon_with_no_snippet_record", () => {
    const beacon: FileEvent = { kind: EventKind.userEdit, changeId: new Uuid("u1"), target: new Path("/a/f.txt"), content: "a", timestamp: new Date("2026-01-01T00:00:05Z") };
    const reader: BackupReader = () => "WRONG";
    const result = insertElidedBeaconSeeds([], [beacon], reader);
    assert.deepEqual(result, [beacon]);
});

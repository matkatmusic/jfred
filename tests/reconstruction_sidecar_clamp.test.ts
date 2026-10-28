// Task 224: `normalizeSeedBetweenPreviousAndEdit` gives a backup-stamped seed a window between the previous event and its edit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSeedBetweenPreviousAndEdit } from "../src/reconstruction_sidecar.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { WriteEvent } from "../src/reconstruction_events.ts";

// A synthetic backup seed stamped at `atMillis`, shaped as `getBackupSeedWrite` builds one.
function buildBackupSeedAt(atMillis: number): WriteEvent {
    return {
        kind: EventKind.write,
        changeId: new Uuid("04b5333dde2392bd@v2"),
        target: new Path("/w/plate_cli.py"),
        content: "seeded\n",
        timestamp: new Date(atMillis),
    };
}

test("test_clamp_leaves_a_seed_that_already_follows_the_previous_event", () => {
    // Scenario: the seed already sits inside its window, so it stays. Action: seed at 100, previous 50, edit 200.
    const placed = normalizeSeedBetweenPreviousAndEdit(buildBackupSeedAt(100), new Date(200), new Date(50));
    // Test verification: the seed comes back with its own instant untouched.
    assert.equal(placed.timestamp.getTime(), 100);
});

test("test_clamp_pulls_a_seed_stamped_at_or_after_its_edit_to_just_before_it", () => {
    // Scenario: a backup taken after its edit moves to just before it. Action: seed 300, edit 200.
    const placed = normalizeSeedBetweenPreviousAndEdit(buildBackupSeedAt(300), new Date(200), new Date(50));
    // Test verification: the seed lands one millisecond before the edit.
    assert.equal(placed.timestamp.getTime(), 199);
});

test("test_clamp_pushes_a_seed_stamped_before_the_previous_event_up_to_it", () => {
    // Task 224: a backup older than the previous event must not go backwards. Action: seed 50, previous 100.
    const placed = normalizeSeedBetweenPreviousAndEdit(buildBackupSeedAt(50), new Date(200), new Date(100));
    // Test verification: the seed is pushed up to the previous event's instant.
    assert.equal(placed.timestamp.getTime(), 100);
});

test("test_clamp_keeps_the_seed_before_its_edit_when_no_slot_exists", () => {
    // Scenario: no valid window, so the seed still sorts before its edit. Action: seed 50, previous 500, edit 200.
    const placed = normalizeSeedBetweenPreviousAndEdit(buildBackupSeedAt(50), new Date(200), new Date(500));
    // Test verification: the seed still lands one millisecond before its edit.
    assert.equal(placed.timestamp.getTime(), 199);
});

test("test_clamp_leaves_the_first_seed_alone_when_nothing_precedes_it", () => {
    // Scenario: the first seed has no lower bound, only the edit. Action: seed 50, no previous, edit 200.
    const placed = normalizeSeedBetweenPreviousAndEdit(buildBackupSeedAt(50), new Date(200), undefined);
    // Test verification: the seed keeps its own instant.
    assert.equal(placed.timestamp.getTime(), 50);
});

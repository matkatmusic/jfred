// Task 224: `backupSeedWriteFor` stamps its synthetic seed with the BACKUP's own instant, which answers
// to neither of the bounds the seed must sit between — the event it is pushed after, and the edit it
// seeds. `clampSeedBetweenPreviousAndEdit` gives it that two-sided window. The tests below pin every
// placement: the no-op (what keeps every already-monotonic ladder byte-for-byte unchanged), the
// pre-existing upper clamp, the task-224 lower clamp, the no-valid-slot case, and the first-seed case.
// Lives beside reconstruction_sidecar.test.ts rather than inside it — that file is at the 250-line cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSeedBetweenPreviousAndEdit } from "../src/reconstruction_sidecar.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { WriteEvent } from "../src/reconstruction_engine.ts";

// A synthetic backup seed stamped at `atMillis`, shaped as `backupSeedWriteFor` builds one (its
// changeId is the backup blob name, per that function's contract).
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
    // Scenario: the ladder is already monotonic — the seed sits inside its window — so the clamp must
    // not touch it. This no-op is what guarantees zero blast radius on the char-locked scenarios.
    // Test action: place a seed at 100, between a previous event at 50 and its edit at 200.
    const placed = clampSeedBetweenPreviousAndEdit(buildBackupSeedAt(100), new Date(200), new Date(50));
    // Test verification: the seed comes back with its own instant untouched.
    assert.equal(placed.timestamp.getTime(), 100);
});

test("test_clamp_pulls_a_seed_stamped_at_or_after_its_edit_to_just_before_it", () => {
    // Scenario: the UPPER-bound behavior of the deleted `seedBeforeEdit` must be preserved exactly — a
    // backup taken after the edit it seeds (s64's post-/clear edit; s19/s23/m6's includeAfter backup) is
    // pulled to just before that edit, so the per-step timeline shows base THEN edited state.
    // Test action: place a seed at 300, after its edit at 200.
    const placed = clampSeedBetweenPreviousAndEdit(buildBackupSeedAt(300), new Date(200), new Date(50));
    // Test verification: the seed lands one millisecond before the edit.
    assert.equal(placed.timestamp.getTime(), 199);
});

test("test_clamp_pushes_a_seed_stamped_before_the_previous_event_up_to_it", () => {
    // Scenario (task 224): a mid-window `gitBase:` beacon precedes the stale edit and the recovered
    // backup is OLDER than that beacon, so pushing the seed at the backup's own instant would move the
    // ladder backwards.
    // Test action: place a seed at 50 after a previous event at 100, seeding an edit at 200.
    const placed = clampSeedBetweenPreviousAndEdit(buildBackupSeedAt(50), new Date(200), new Date(100));
    // Test verification: the seed is pushed up to the previous event's instant, so the sequence is
    // non-decreasing instead of going backwards.
    assert.equal(placed.timestamp.getTime(), 100);
});

test("test_clamp_keeps_the_seed_before_its_edit_when_no_slot_exists", () => {
    // Scenario: the previous event is already at/after the edit, so the array was non-monotonic BEFORE
    // this seed and no valid window exists. The "a seed sorts before the edit it seeds" invariant is the
    // load-bearing one, so it wins.
    // Test action: place a seed at 50 after a previous event at 500, seeding an edit at 200.
    const placed = clampSeedBetweenPreviousAndEdit(buildBackupSeedAt(50), new Date(200), new Date(500));
    // Test verification: the seed still lands one millisecond before its edit.
    assert.equal(placed.timestamp.getTime(), 199);
});

test("test_clamp_leaves_the_first_seed_alone_when_nothing_precedes_it", () => {
    // Scenario: the seed is the first event pushed into the result, so there is no lower bound to clamp
    // against and only the edit bounds it.
    // Test action: place a seed at 50 with no previous event, seeding an edit at 200.
    const placed = clampSeedBetweenPreviousAndEdit(buildBackupSeedAt(50), new Date(200), undefined);
    // Test verification: the seed keeps its own instant.
    assert.equal(placed.timestamp.getTime(), 50);
});

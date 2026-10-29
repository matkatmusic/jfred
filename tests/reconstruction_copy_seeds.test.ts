import { test } from "node:test";
import assert from "node:assert/strict";
import { fillCopySeeds } from "../src/reconstruction_copy_seeds.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import type { CopyEvent, FileEvent } from "../src/reconstruction_events.ts";

const COPY: CopyEvent = {
    kind: EventKind.copy,
    changeId: new Uuid("toolu_copy"),
    from: new Path("/proj/a.txt"),
    to: new Path("/proj/b.txt"),
    seedLines: ["stale"],
    timestamp: new Date("2026-01-01T00:00:01Z"),
};

test("test_fillCopySeeds_passes_non_copy_events_through", () => {
    const events: FileEvent[] = [];
    assert.deepEqual(fillCopySeeds([], events, new Set()), []);
});

test("test_fillCopySeeds_empties_the_seed_when_the_destination_is_already_resolving", () => {
    const seeded = fillCopySeeds([], [COPY], new Set(["/proj/b.txt"]));
    assert.deepEqual(seeded, [{ ...COPY, seedLines: [] }]);
});

test("test_fillCopySeeds_empties_the_seed_when_the_source_has_no_revision", () => {
    const seeded = fillCopySeeds([], [COPY], new Set());
    assert.deepEqual(seeded, [{ ...COPY, seedLines: [] }]);
});

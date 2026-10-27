// Splicing of committed-blob diffs into a lineage as user edits.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findBlobDiffPlacement, insertAdditionsAfter } from "../src/reconstruction_git_splice.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";
import type { BackupReader } from "../src/reconstruction_sidecar.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const target = new Path("/tmp/repo/a.txt");
const emptyReader: BackupReader = () => "";

function buildWrite(content: string, timestamp: string): FileEvent {
    return { kind: EventKind.write, changeId: new Uuid("w"), target, content, timestamp: new Date(timestamp) };
}

test("test_insertAdditionsAfter_inserts_a_user_edit_when_replay_matches_the_blob", () => {
    const events = [buildWrite("a\n", "2026-01-01T00:00:00Z")];
    const additions = [{ anchor: "a", line: "b" }];
    const placed = insertAdditionsAfter(0, additions, [], "a\nb\n", events, [], target, [], emptyReader, new Date("2026-01-01T00:10:00Z"));
    assert.equal(placed!.length, 2);
    assert.equal(placed![1]!.kind, EventKind.userEdit);
    assert.equal((placed![1] as { content: string }).content, "a\nb\n");
});

test("test_insertAdditionsAfter_rejects_when_replay_differs_from_the_blob", () => {
    const events = [buildWrite("a\n", "2026-01-01T00:00:00Z")];
    const additions = [{ anchor: "a", line: "b" }];
    const placed = insertAdditionsAfter(0, additions, [], "a\nzzz\n", events, [], target, [], emptyReader, new Date("2026-01-01T00:10:00Z"));
    assert.equal(placed, undefined);
});

test("test_findBlobDiffPlacement_places_a_pure_addition_and_skips_identical_content", () => {
    const events = [buildWrite("a\n", "2026-01-01T00:00:00Z")];
    const evidence = new Date("2026-01-01T00:10:00Z");
    const placed = findBlobDiffPlacement("a\nb\n", evidence, events, [], target, [], emptyReader);
    assert.equal(placed!.length, 2);
    assert.equal(findBlobDiffPlacement("a\n", evidence, events, [], target, [], emptyReader), undefined);
    assert.equal(findBlobDiffPlacement("a\nb\n", new Date("2025-01-01T00:00:00Z"), events, [], target, [], emptyReader), undefined);
});

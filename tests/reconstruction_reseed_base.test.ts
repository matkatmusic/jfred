import { test } from "node:test";
import assert from "node:assert/strict";
import {
    findLastPriorTime,
    getReconstructedBaseText,
    isEditBaseStale,
    isFirstHunkMatchingBase,
    isLinePrefix,
} from "../src/reconstruction_reseed_base.ts";
import type { EditEvent, WriteEvent } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

const target = new Path("/work/a.txt");

const write: WriteEvent = {
    kind: EventKind.write,
    changeId: new Uuid("w1"),
    target,
    content: "hello\nworld\n",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
};

function buildEdit(lines: string[]): EditEvent {
    return {
        kind: EventKind.edit,
        changeId: new Uuid("e1"),
        target,
        hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines }],
        timestamp: new Date("2026-01-01T00:00:01.000Z"),
    };
}

test("test_get_reconstructed_base_text_returns_replayed_lines", () => {
    assert.deepEqual(getReconstructedBaseText([write]), ["hello", "world"]);
});

test("test_is_first_hunk_matching_base_checks_context_and_removed_lines", () => {
    const edit = buildEdit([" hello", "-world", "+planet"]);
    assert.equal(isFirstHunkMatchingBase(edit, ["hello", "world"]), true);
    assert.equal(isFirstHunkMatchingBase(edit, ["hello", "other"]), false);
    assert.equal(isFirstHunkMatchingBase(edit, ["hello"]), false);
});

test("test_is_edit_base_stale_flags_mismatched_base", () => {
    const edit = buildEdit([" nope", "-world", "+planet"]);
    assert.equal(isEditBaseStale(edit, [write]), true);
    assert.equal(isEditBaseStale(buildEdit([" hello", "-world", "+planet"]), [write]), false);
});

test("test_is_line_prefix_compares_leading_lines", () => {
    assert.equal(isLinePrefix(["a"], ["a", "b"]), true);
    assert.equal(isLinePrefix(["b"], ["a", "b"]), false);
});

test("test_find_last_prior_time_picks_latest_for_target", () => {
    const later: WriteEvent = { ...write, changeId: new Uuid("w2"), timestamp: new Date("2026-01-02T00:00:00.000Z") };
    assert.equal(findLastPriorTime(target, [later, write])?.toISOString(), "2026-01-02T00:00:00.000Z");
    assert.equal(findLastPriorTime(new Path("/work/b.txt"), [write]), undefined);
});

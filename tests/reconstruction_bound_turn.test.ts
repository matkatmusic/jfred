// task 193: turn-end boundary search and the within-bound filter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { findTurnEndBoundary, isRecordWithinBound } from "../src/reconstruction_bound_turn.ts";
import { createBoundFixture } from "./reconstruction_bound_fixture.ts";

test("test_find_turn_end_boundary_returns_next_prompt_after_instant", () => {
    const { records } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const boundary = findTurnEndBoundary(records, new Date("2026-07-23T10:02:00.000Z"), undefined);
    assert.equal(boundary?.instant.toISOString(), "2026-07-23T10:05:00.000Z");
});

test("test_find_turn_end_boundary_is_undefined_after_last_prompt", () => {
    const { records } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const boundary = findTurnEndBoundary(records, new Date("2026-07-23T10:11:00.000Z"), undefined);
    assert.equal(boundary, undefined);
});

test("test_is_record_within_bound_keeps_only_records_before_boundary", () => {
    const { records } = createBoundFixture({ withFinalPrompt: true, withSidechainPrompt: false });
    const boundary = findTurnEndBoundary(records, new Date("2026-07-23T10:02:00.000Z"), undefined)!;
    assert.equal(isRecordWithinBound(records[0]!, 0, boundary), true);
    assert.equal(isRecordWithinBound(records[boundary.index]!, boundary.index, boundary), false);
});

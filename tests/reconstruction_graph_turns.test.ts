import { test } from "node:test";
import assert from "node:assert/strict";
import { formatColumnLabel, convertEventToGraphTurn } from "../src/reconstruction_graph_turns.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { FileEvent } from "../src/reconstruction_events.ts";

test("test_format_column_label_is_bijective_base_26", () => {
    assert.equal(formatColumnLabel(0), "A");
    assert.equal(formatColumnLabel(25), "Z");
    assert.equal(formatColumnLabel(26), "AA");
    assert.equal(formatColumnLabel(27), "AB");
});

test("test_convert_event_to_graph_turn_uses_destination_for_rename_and_placeholder_without_letter", () => {
    const event = {
        kind: EventKind.rename,
        from: new Path("/work/old.py"),
        to: new Path("/work/new.py"),
        changeId: new Uuid("u1"),
        timestamp: new Date("2026-01-01T16:01:00Z"),
    } as unknown as FileEvent;
    const lettered = convertEventToGraphTurn(event, new Map([["u1", "B"]]));
    assert.equal(lettered.letter, "B");
    assert.equal(lettered.target.toString(), "/work/new.py");
    const unlettered = convertEventToGraphTurn(event, new Map());
    assert.equal(unlettered.letter, "?");
});

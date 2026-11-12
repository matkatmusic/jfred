// buildReverseWalkWire: engine ReverseFileState rows become the server-typed WireReverseWalkOf<Date, Path>.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ReverseStateKind, type ReverseFileState } from "../engineV3/engineV3_replay_reverse.ts";
import { buildReverseWalkWire } from "../src/layer1_reverse_wire.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import { WireReverseKind } from "../webapp/layer1-wire-reverse.ts";

test("test_buildReverseWalkWire_leaves_out_the_undefined_fields_of_the_disk_state", () => {
    // a disk state has no timestamp, no content and no source
    const diskState: ReverseFileState = { index: 0, kind: ReverseStateKind.DiskNow, timestamp: undefined, content: undefined, jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true };
    // build the wire
    const wire = buildReverseWalkWire("a.txt", [diskState]);
    // the state has only index and kind
    assert.deepEqual(wire, { path: "a.txt", states: [{ index: 0, kind: WireReverseKind.DiskNow, isModifying: true }] });
});

test("test_buildReverseWalkWire_always_sends_isModifying_even_when_false", () => {
    // a state that does not modify
    const readState: ReverseFileState = { index: 1, kind: ReverseStateKind.ReadOnly, timestamp: undefined, content: undefined, jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: false };
    // build the wire
    const wire = buildReverseWalkWire("a.txt", [readState]);
    // the field is present and false
    assert.equal(wire.states[0]!.isModifying, false);
});

test("test_buildReverseWalkWire_renames_timestamp_to_instant_and_keeps_the_source", () => {
    // an undone edit has every field
    const timestamp = new Date("2026-01-01T00:00:05.000Z");
    const editState: ReverseFileState = { index: 1, kind: ReverseStateKind.EditUndone, timestamp, content: "old", jsonlPath: new Path("/s/s1.jsonl"), lineNumber: 7, commitHash: undefined, isModifying: true };
    // build the wire
    const wire = buildReverseWalkWire("a.txt", [editState]);
    // the instant, content, source path and line number are all present
    assert.deepEqual(wire.states[0], { index: 1, kind: WireReverseKind.EditUndone, instant: timestamp, content: "old", jsonlPath: new Path("/s/s1.jsonl"), lineNumber: 7, isModifying: true });
});

test("test_buildReverseWalkWire_keeps_empty_content_as_a_present_field", () => {
    // a state whose text is the empty string
    const emptyState: ReverseFileState = { index: 2, kind: ReverseStateKind.WriteUndone, timestamp: new Date(0), content: "", jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true };
    // build the wire
    const wire = buildReverseWalkWire("a.txt", [emptyState]);
    // the content field is still there
    assert.equal(wire.states[0]!.content, "");
});

test("test_buildReverseWalkWire_maps_every_engine_kind_to_the_wire_kind_with_the_same_value", () => {
    // one state for every engine kind
    const states: ReverseFileState[] = Object.values(ReverseStateKind).map((kind, index) => ({ index, kind, timestamp: undefined, content: undefined, jsonlPath: undefined, lineNumber: undefined, commitHash: undefined, isModifying: true }));
    // build the wire
    const wire = buildReverseWalkWire("a.txt", states);
    // each wire kind has the same string as its engine kind
    assert.deepEqual(wire.states.map((state) => state.kind), states.map((state) => state.kind as string));
});

test("test_buildReverseWalkWire_keeps_the_commit_hash_as_a_string", () => {
    // a commit state with a hash
    const commitState: ReverseFileState = { index: 1, kind: ReverseStateKind.GitCommit, timestamp: new Date(0), content: "a", jsonlPath: undefined, lineNumber: undefined, commitHash: new Uuid("0123456789abcdef0123456789abcdef01234567"), isModifying: true };
    // build the wire
    const wire = buildReverseWalkWire("a.txt", [commitState]);
    // the wire holds the hash as a plain string
    assert.equal(wire.states[0]!.commitHash, "0123456789abcdef0123456789abcdef01234567");
});

test("test_buildReverseWalkWire_throws_on_an_unknown_kind", () => {
    // a state with a kind the wire does not know
    const strangeState = { index: 0, kind: "Strange", timestamp: undefined, content: undefined, jsonlPath: undefined, lineNumber: undefined } as unknown as ReverseFileState;
    // building throws
    assert.throws(() => buildReverseWalkWire("a.txt", [strangeState]), /Strange/);
});

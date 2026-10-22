// Task 355 step 4: one path's ordered events replay into base, target and confidence, with an injected seed reader.

import assert from "node:assert/strict";
import { test } from "node:test";
import { replayPathEvents, type SeedBaseReader } from "../src/layer1_edit_replay.ts";
import type { LayerEditEvent } from "../src/layer1_edit_events.ts";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { StructuredPatchHunk } from "../src/structures/tool-results.ts";
import { WireConfidence, WireEditKind } from "../webapp/layer1-wire.ts";

const BASE_TEXT = "a\nb\nc\n";
const NO_SEED: SeedBaseReader = () => undefined;

function buildHunk(removed: string, added: string): StructuredPatchHunk {
    return { oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" a", `-${removed}`, `+${added}`, " c"] };
}

function buildEvent(changeId: string, kind: WireEditKind, extra: Partial<LayerEditEvent>): LayerEditEvent {
    return {
        changeId: new Uuid(changeId), kind, target: new Path("/work/a.txt"), instant: new Date(0),
        sessionId: new Uuid("s1"), sessionFile: new Path("/work/s1.jsonl"), line: 1, ...extra,
    };
}

function buildRead(changeId: string, content: string): LayerEditEvent {
    return buildEvent(changeId, WireEditKind.read, { content });
}

function buildEdit(changeId: string, removed: string, added: string): LayerEditEvent {
    return buildEvent(changeId, WireEditKind.edit, { hunks: [buildHunk(removed, added)] });
}

test("test_read_is_verified_beacon", () => {
    const node = replayPathEvents([buildRead("r1", BASE_TEXT)], NO_SEED).get("r1")!;
    assert.deepEqual(node, { base: ["a", "b", "c"], target: ["a", "b", "c"], confidence: WireConfidence.verified });
});

test("test_edit_on_matching_base_is_verified", () => {
    const node = replayPathEvents([buildRead("r1", BASE_TEXT), buildEdit("e1", "b", "B")], NO_SEED).get("e1")!;
    assert.deepEqual(node, { base: ["a", "b", "c"], target: ["a", "B", "c"], confidence: WireConfidence.verified });
});

test("test_edit_chain_computes_predecessor_first", () => {
    const events = [buildRead("r1", BASE_TEXT), buildEdit("e1", "b", "B"), buildEdit("e2", "B", "BB")];
    const node = replayPathEvents(events, NO_SEED).get("e2")!;
    assert.deepEqual(node.base, ["a", "B", "c"]);
    assert.deepEqual(node.target, ["a", "BB", "c"]);
    assert.equal(node.confidence, WireConfidence.verified);
});

test("test_write_replaces_whole_body", () => {
    const events = [buildRead("r1", BASE_TEXT), buildEvent("w1", WireEditKind.write, { content: "x\ny\n" })];
    const replayed = replayPathEvents(events, NO_SEED);
    assert.deepEqual(replayed.get("w1"), { base: ["a", "b", "c"], target: ["x", "y"], confidence: WireConfidence.verified });
    const alone = replayPathEvents([buildEvent("w2", WireEditKind.write, { content: "x\n" })], NO_SEED).get("w2")!;
    assert.deepEqual(alone.base, []);
});

test("test_mismatched_hunk_is_derived_and_best_effort_applied", () => {
    const node = replayPathEvents([buildRead("r1", "a\nz\nc\n"), buildEdit("e1", "b", "B")], NO_SEED).get("e1")!;
    assert.deepEqual(node, { base: ["a", "z", "c"], target: ["a", "B", "c"], confidence: WireConfidence.derived });
});

test("test_mismatched_hunk_with_matching_seed_is_reseeded", () => {
    const readSeedBase: SeedBaseReader = () => ["a", "b", "c"];
    const node = replayPathEvents([buildRead("r1", "a\nz\nc\n"), buildEdit("e1", "b", "B")], readSeedBase).get("e1")!;
    assert.deepEqual(node, { base: ["a", "b", "c"], target: ["a", "B", "c"], confidence: WireConfidence.reseeded });
});

test("test_seed_that_does_not_match_stays_derived", () => {
    const readSeedBase: SeedBaseReader = () => ["q", "r", "s"];
    const node = replayPathEvents([buildRead("r1", "a\nz\nc\n"), buildEdit("e1", "b", "B")], readSeedBase).get("e1")!;
    assert.deepEqual(node.base, ["a", "z", "c"]);
    assert.equal(node.confidence, WireConfidence.derived);
});

test("test_next_read_that_differs_marks_whole_segment_derived", () => {
    const edits = [buildRead("r1", BASE_TEXT), buildEdit("e1", "b", "B"), buildEdit("e2", "B", "BB")];
    const agreeing = replayPathEvents([...edits, buildRead("r2", "a\nBB\nc\n")], NO_SEED);
    assert.equal(agreeing.get("e1")!.confidence, WireConfidence.verified);
    const differing = replayPathEvents([...edits, buildRead("r2", "a\nother\nc\n")], NO_SEED);
    assert.equal(differing.get("e1")!.confidence, WireConfidence.derived);
    assert.equal(differing.get("e2")!.confidence, WireConfidence.derived);
    assert.equal(differing.get("r2")!.confidence, WireConfidence.verified);
});

test("test_first_edit_with_no_beacon_asks_seed_then_derived_over_empty", () => {
    const asked: string[] = [];
    const readSeedBase: SeedBaseReader = (event) => {
        asked.push(event.changeId.toString());
        return undefined;
    };
    const node = replayPathEvents([buildEdit("e1", "b", "B")], readSeedBase).get("e1")!;
    assert.deepEqual(asked, ["e1"]);
    assert.deepEqual(node.base, []);
    assert.equal(node.confidence, WireConfidence.derived);
});

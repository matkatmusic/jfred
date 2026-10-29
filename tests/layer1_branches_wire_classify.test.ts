// Task 357 step 4: lane classification reads the pre-state evidence to pick a rewind kind.

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLaneKind, collectWriteOriginalFiles, type PreStateEvidence } from "../src/layer1_branches_wire_classify.ts";
import type { FileRevision } from "../src/reconstruction_events.ts";
import { Uuid } from "../src/structures/domain.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { WireRewindKind } from "../webapp/layer1-wire-branches.ts";

function makeRevision(changeId: string, text: string[], minute: number): FileRevision {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, minute));
    return { kind: EventKind.edit, changeId: new Uuid(changeId), timestamp, lines: text.map((line, index) => ({ oldLineNum: index, values: [{ line, timestamp }] })) };
}

const NO_EVIDENCE: PreStateEvidence = { eventById: new Map(), writeOriginalFileById: new Map() };

test("test_collectWriteOriginalFiles_returns_empty_map_for_no_records", () => {
    assert.equal(collectWriteOriginalFiles([]).size, 0);
});

test("test_computeLaneKind_gives_conversation_kept_to_end_when_lane_is_disk_final", () => {
    const revisions = [makeRevision("a", ["x"], 1), makeRevision("lane", ["x", "y"], 2)];
    assert.deepEqual(computeLaneKind(revisions, 1, new Set(["lane"]), NO_EVIDENCE), { rewindKind: WireRewindKind.conversation, keptToEnd: true });
});

test("test_computeLaneKind_gives_code_when_disk_final_differs_from_lane", () => {
    const revisions = [makeRevision("lane", ["x", "y"], 1), makeRevision("other-lane", ["z"], 2)];
    assert.deepEqual(computeLaneKind(revisions, 0, new Set(["lane", "other-lane"]), NO_EVIDENCE), { rewindKind: WireRewindKind.code });
});

test("test_computeLaneKind_rejoins_next_revision_that_keeps_lane_lines", () => {
    const revisions = [makeRevision("lane", ["x"], 1), makeRevision("next", ["x", "y"], 2)];
    const kind = computeLaneKind(revisions, 0, new Set(["lane"]), NO_EVIDENCE);
    assert.equal(kind.rewindKind, WireRewindKind.conversation);
    assert.equal(kind.rejoinAt?.getTime(), revisions[1]!.timestamp.getTime());
});

test("test_computeLaneKind_gives_code_when_next_revision_drops_lane_lines", () => {
    const revisions = [makeRevision("lane", ["x"], 1), makeRevision("next", ["q"], 2)];
    assert.deepEqual(computeLaneKind(revisions, 0, new Set(["lane"]), NO_EVIDENCE), { rewindKind: WireRewindKind.code });
});

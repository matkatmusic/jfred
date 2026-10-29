import { test } from "node:test";
import assert from "node:assert/strict";
import { RevisionViewMode, computeFileRouteFocus, computeFocusedCardIndex, isChangeIdGitBaseline } from "../webapp/views/details-model.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

const FILES_TOUCHED = [
    { target: "a.ts", revisions: [{ kind: EventKind.write as string, changeId: "c1", timestamp: "2026-07-01T10:00:00Z" }] },
    { target: "b.ts", revisions: [{ kind: EventKind.write as string, changeId: "c2", timestamp: "2026-07-01T10:01:00Z" }] },
];

test("test_computeFileRouteFocus_focuses_the_numbered_revision_of_the_target", () => {
    assert.deepEqual(computeFileRouteFocus(FILES_TOUCHED, "b.ts", "1"), { changeId: "c2", mode: RevisionViewMode.content });
});

test("test_computeFileRouteFocus_returns_undefined_for_unknown_target_or_bad_number", () => {
    assert.equal(computeFileRouteFocus(FILES_TOUCHED, "z.ts", "1"), undefined);
    assert.equal(computeFileRouteFocus(FILES_TOUCHED, "a.ts", "9"), undefined);
});

test("test_computeFocusedCardIndex_falls_back_to_the_first_card", () => {
    const cards = [
        { revisionNumber: 1, opLabel: "write", timestamp: "t", changeId: "c1" },
        { revisionNumber: 2, opLabel: "edit", timestamp: "t", changeId: "c2" },
    ];
    assert.equal(computeFocusedCardIndex(cards, { changeId: "c2", mode: RevisionViewMode.diff }), 1);
    assert.equal(computeFocusedCardIndex(cards, { changeId: "nope", mode: RevisionViewMode.diff }), 0);
    assert.equal(computeFocusedCardIndex(cards, undefined), 0);
});

test("test_isChangeIdGitBaseline_detects_the_beacon_prefix", () => {
    assert.equal(isChangeIdGitBaseline("gitBase:abc:f.ts"), true);
    assert.equal(isChangeIdGitBaseline(undefined), false);
});

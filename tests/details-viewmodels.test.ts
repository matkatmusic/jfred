// View-model tests for the Details pane: header text per node kind and 1-based revision cards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRevisionCards, computeDetailsHeaderText } from "../webapp/views/details-model.ts";
import { AGENT_TURN_NODE_KIND, COMMIT_NODE_KIND, type TimelineNode } from "../webapp/views/timeline-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";

test("test_computeDetailsHeaderText_formats_message_nodes", () => {
    // Step 1: an agent turn at a known instant, shown as row 3 of 10.
    const node: TimelineNode = {
        kind: AGENT_TURN_NODE_KIND,
        when: "2026-07-01T10:20:30Z",
        sessionId: "abc12345",
        text: "hello",
        snapshots: [],
        gitOperations: [],
    };
    // Step 2: the header names the 1-based step, the total, the kind, and the timestamp.
    const expectedTimestamp = new Date("2026-07-01T10:20:30Z").toLocaleString();
    assert.equal(
        computeDetailsHeaderText(node, { index: 2, total: 10 }),
        `Step 3 of 10 — agent turn — ${expectedTimestamp}`,
    );
});

test("test_computeDetailsHeaderText_formats_commit_nodes_with_hash", () => {
    // Step 1: a commit node carrying its short result hash and -m message.
    const node: TimelineNode = {
        kind: COMMIT_NODE_KIND,
        when: "2026-07-01T11:00:00Z",
        sessionId: "abc12345",
        detail: "fix: x",
        resultHash: "4fa08d2",
    };
    // Step 2: commit headers lead with the hash instead of a step position.
    const expectedTimestamp = new Date("2026-07-01T11:00:00Z").toLocaleString();
    assert.equal(
        computeDetailsHeaderText(node, { index: 5, total: 9 }),
        `git commit 4fa08d2 — fix: x — ${expectedTimestamp}`,
    );
});

test("test_computeDetailsHeaderText_omits_missing_hash", () => {
    // Step 1: a commit whose tool_result echoed no hash.
    const node: TimelineNode = {
        kind: COMMIT_NODE_KIND,
        when: "2026-07-01T11:00:00Z",
        sessionId: "abc12345",
        detail: "fix: x",
    };
    // Step 2: the hash segment is dropped; a placeholder dash reads broken (s58).
    const expectedTimestamp = new Date("2026-07-01T11:00:00Z").toLocaleString();
    assert.equal(
        computeDetailsHeaderText(node, { index: 5, total: 9 }),
        `git commit — fix: x — ${expectedTimestamp}`,
    );
});

test("test_buildRevisionCards_numbers_revisions_and_carries_kinds", () => {
    // Step 1: a wire file history with two revisions of different kinds.
    const history = {
        target: "src/orders.py",
        revisions: [
            { kind: EventKind.write as string, changeId: "toolu_A1", timestamp: "2026-07-01T10:00:00Z" },
            { kind: EventKind.userEdit as string, changeId: "toolu_B2", timestamp: "2026-07-01T10:05:00Z" },
        ],
    };
    // Step 2: cards are 1-based and carry kind, timestamp and changeId; none is unrecoverable.
    assert.deepEqual(buildRevisionCards(history), [
        { revisionNumber: 1, opLabel: EventKind.write, timestamp: "2026-07-01T10:00:00Z", changeId: "toolu_A1", unrecoverableReason: undefined },
        { revisionNumber: 2, opLabel: EventKind.userEdit, timestamp: "2026-07-01T10:05:00Z", changeId: "toolu_B2", unrecoverableReason: undefined },
    ]);
});

test("test_buildRevisionCards_flags_unrecoverable_revision", () => {
    // Step 1: a history whose second revision the engine could not replay (task 119).
    const history = {
        target: "src/orders.py",
        revisions: [
            { kind: EventKind.write as string, changeId: "toolu_A1", timestamp: "2026-07-01T10:00:00Z" },
            { kind: EventKind.edit as string, changeId: "toolu_B2", timestamp: "2026-07-01T10:05:00Z", unrecoverable: { reason: "sidecar backup missing" } },
        ],
    };
    // Step 2: the placeholder's card carries the reason; the recovered card carries none.
    const cards = buildRevisionCards(history);
    assert.equal(cards[0]!.unrecoverableReason, undefined);
    assert.equal(cards[1]!.unrecoverableReason, "sidecar backup missing");
});

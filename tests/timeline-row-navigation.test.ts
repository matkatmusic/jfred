// Pure row-navigation helpers from timeline-sessions.ts, split out to stay under the 250-line cap.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    checkRowCarriesJsonRecordButton,
    findAdjacentFileTouchedIndex,
    findAdjacentRowIndex,
} from "../webapp/views/timeline-sessions.ts";
import {
    AGENT_TURN_NODE_KIND,
    COMMIT_NODE_KIND,
    USER_TURN_NODE_KIND,
    type CommitNode,
    type FileChange,
    type TurnNode,
} from "../webapp/views/timeline-types.ts";
import { EventKind } from "../src/structures/vocabulary.ts";


function makeTurnNodeFixture(
    kind: typeof USER_TURN_NODE_KIND | typeof AGENT_TURN_NODE_KIND,
    fileChanges: FileChange[],
): TurnNode {
    return {
        kind,
        when: "2026-01-01T00:00:00.000Z",
        sessionId: undefined,
        text: "",
        snapshots: [],
        gitOperations: [],
        fileChanges,
    };
}

const singleFileChangeFixture: FileChange[] = [{
    path: "orders.py",
    displayPath: "orders.py",
    eventKind: EventKind.edit,
    renamedFrom: undefined,
    isFirstRevision: false,
    changeId: undefined,
    when: "2026-01-01T00:00:00.000Z",
}];

test("test_findAdjacentFileTouchedIndex_next_from_before_start_finds_first_candidate", () => {
    // A reference index of -1 means "before the first row".
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    assert.equal(findAdjacentFileTouchedIndex(nodes, -1, 1), 2);
});

test("test_findAdjacentFileTouchedIndex_next_skips_non_agent_and_chipless_rows", () => {
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    assert.equal(findAdjacentFileTouchedIndex(nodes, 0, 1), 3);
});

test("test_findAdjacentFileTouchedIndex_prev_finds_nearest_earlier_candidate", () => {
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    assert.equal(findAdjacentFileTouchedIndex(nodes, 3, -1), 0);
});

test("test_findAdjacentFileTouchedIndex_returns_undefined_when_no_candidate_in_direction", () => {
    // Undefined means the Prev/Next button no-ops.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
    ];
    assert.equal(findAdjacentFileTouchedIndex(nodes, 0, 1), undefined);
});


test("test_checkRowCarriesJsonRecordButton_true_for_turn_with_uuid", () => {
    const turnWithRecord = { ...makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []), uuid: "rec-1" };
    assert.equal(checkRowCarriesJsonRecordButton(turnWithRecord), true);
});

test("test_checkRowCarriesJsonRecordButton_false_for_commit_rows", () => {
    // Commits are repo events with no JSONL record behind them.
    const plainCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t1", sessionId: "s" };
    assert.equal(checkRowCarriesJsonRecordButton(plainCommit), false);
});

test("test_checkRowCarriesJsonRecordButton_false_for_uuid_less_synthetic_turns", () => {
    // The git baseline turn is synthetic, so a { } button on it could only error.
    const baselineTurn = { ...makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []), isGitBaseline: true };
    assert.equal(checkRowCarriesJsonRecordButton(baselineTurn), false);
});


test("test_findAdjacentRowIndex_steps_one_row_in_each_direction", () => {
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    assert.equal(findAdjacentRowIndex(nodes, 1, 1), 2);
    assert.equal(findAdjacentRowIndex(nodes, 1, -1), 0);
});

test("test_findAdjacentRowIndex_returns_undefined_past_either_end", () => {
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
    ];
    assert.equal(findAdjacentRowIndex(nodes, 2, 1), undefined);
    assert.equal(findAdjacentRowIndex(nodes, 0, -1), undefined);
});

test("test_findAdjacentRowIndex_next_from_before_start_selects_first_row", () => {
    // fileNavReferenceIndex starts at -1, so Next must select row 0.
    const nodes = [makeTurnNodeFixture(USER_TURN_NODE_KIND, [])];
    assert.equal(findAdjacentRowIndex(nodes, -1, 1), 0);
});

test("test_uuid_less_line_node_rows_carry_the_json_record_button", async () => {
    // A uuid-less summary line is still inspectable: it opens by source line, not uuid.
    const { LINE_NODE_KIND } = await import("../webapp/views/timeline-line-nodes.ts");
    const summaryLineNode = {
        kind: LINE_NODE_KIND,
        when: "",
        sessionId: undefined,
        text: "summary · ignore",
        sourceJsonlName: "session-a.jsonl",
        sourceLineIndex: 3,
    };
    assert.equal(checkRowCarriesJsonRecordButton(summaryLineNode as never), true);
});

// Header row-navigation model (timeline-sessions.ts): the task-85 file-touched Prev/Next walker,
// the task-131 one-row line-stepper, and the task-135 { } record-button predicate — all pure
// functions over hand-built wire-shape nodes (split from timeline-sessions.test.ts, 250-line cap).

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

// ── task 85: header Prev/Next over file-touching agent turns ──
// findAdjacentFileTouchedIndex reads only kind + fileChanges, so hand-built minimal turn
// nodes (wire shape) exercise it fully.

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
    // Behavior: with the reference before the first row (-1), Next lands on the first
    // agent turn that carries file chips.
    // Steps:
    // a user turn, then a chipless agent turn, then an agent turn with chips.
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // searching forward from -1 returns the chip-bearing row's index.
    assert.equal(findAdjacentFileTouchedIndex(nodes, -1, 1), 2);
});

test("test_findAdjacentFileTouchedIndex_next_skips_non_agent_and_chipless_rows", () => {
    // Behavior: Next skips user turns and agent turns without file changes.
    // Steps:
    // a chip-bearing agent turn, a user turn, a chipless agent turn, a chip-bearing agent turn.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // searching forward from index 0 skips indexes 1 and 2 and lands on 3.
    assert.equal(findAdjacentFileTouchedIndex(nodes, 0, 1), 3);
});

test("test_findAdjacentFileTouchedIndex_prev_finds_nearest_earlier_candidate", () => {
    // Behavior: Prev walks backwards to the nearest earlier chip-bearing agent turn.
    // Steps:
    // same four rows as the skip test, searching backward from the last row.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // searching backward from index 3 skips indexes 2 and 1 and lands on 0.
    assert.equal(findAdjacentFileTouchedIndex(nodes, 3, -1), 0);
});

test("test_findAdjacentFileTouchedIndex_returns_undefined_when_no_candidate_in_direction", () => {
    // Behavior: walking off either end without a candidate is undefined (button no-op).
    // Steps:
    // one chip-bearing agent turn followed only by a user turn.
    const nodes = [
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
    ];
    // searching forward from index 0 finds nothing.
    assert.equal(findAdjacentFileTouchedIndex(nodes, 0, 1), undefined);
});

// ── task 135: the { } row button renders only for rows with a real transcript line ──

test("test_checkRowCarriesJsonRecordButton_true_for_turn_with_uuid", () => {
    // Behavior: an agent turn backed by a transcript record (it has a uuid) carries the { } button.
    // Steps:
    // an agent turn node carrying a record uuid.
    const turnWithRecord = { ...makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []), uuid: "rec-1" };
    assert.equal(checkRowCarriesJsonRecordButton(turnWithRecord), true);
});

test("test_checkRowCarriesJsonRecordButton_false_for_commit_rows", () => {
    // Behavior: commits are repo events with no JSONL record — never a { } button.
    // Steps:
    // a plain commit node.
    const plainCommit: CommitNode = { kind: COMMIT_NODE_KIND, when: "t1", sessionId: "s" };
    assert.equal(checkRowCarriesJsonRecordButton(plainCommit), false);
});

test("test_checkRowCarriesJsonRecordButton_false_for_uuid_less_synthetic_turns", () => {
    // Behavior (task 135): the git-derived baseline turn is synthetic — no uuid, no transcript
    // line behind it — so it must not offer a { } button that can only error.
    // Steps:
    // an agent turn shaped like recordGitBaselineSnapshot's output: isGitBaseline, no uuid.
    const baselineTurn = { ...makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []), isGitBaseline: true };
    assert.equal(checkRowCarriesJsonRecordButton(baselineTurn), false);
});

// ── task 131: header line-stepper walks one visible row at a time ──

test("test_findAdjacentRowIndex_steps_one_row_in_each_direction", () => {
    // Behavior: the line-stepper moves exactly one visible row per click, regardless of kind.
    // Steps:
    // three rows of mixed kinds.
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, singleFileChangeFixture),
    ];
    // one step forward from the middle row lands on the last row.
    assert.equal(findAdjacentRowIndex(nodes, 1, 1), 2);
    // one step backward from the middle row lands on the first row.
    assert.equal(findAdjacentRowIndex(nodes, 1, -1), 0);
});

test("test_findAdjacentRowIndex_returns_undefined_past_either_end", () => {
    // Behavior: stepping off either end of the list is undefined (button disables).
    // Steps:
    // three rows; walk off both ends.
    const nodes = [
        makeTurnNodeFixture(USER_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
        makeTurnNodeFixture(AGENT_TURN_NODE_KIND, []),
    ];
    // forward from the last row finds nothing.
    assert.equal(findAdjacentRowIndex(nodes, 2, 1), undefined);
    // backward from the first row finds nothing.
    assert.equal(findAdjacentRowIndex(nodes, 0, -1), undefined);
});

test("test_findAdjacentRowIndex_next_from_before_start_selects_first_row", () => {
    // Behavior: fileNavReferenceIndex starts at -1 ("before the first row") — Next selects row 0.
    // Steps:
    // any non-empty list, stepping forward from -1.
    const nodes = [makeTurnNodeFixture(USER_TURN_NODE_KIND, [])];
    assert.equal(findAdjacentRowIndex(nodes, -1, 1), 0);
});

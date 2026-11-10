// The engineV3 marker: moves, commit jumps, and the on/off rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    containsCommitAfterMarker, isCurrentEngineV3Node, isMarkerOnFirstStep, isMarkerOnLastStep, moveMarkerBackward, moveMarkerForward,
    moveMarkerToNextCommit, moveMarkerToNode, moveMarkerToPreviousCommit, readMarkerIndex, resetMarkerToStart, storeEngineV3Steps,
} from "../webapp/layer1-components/engine-v3/layer1-engine-v3-state.ts";
import { EngineV3StepKind, type WireEngineV3Step } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";

const { commit, edit, script } = EngineV3StepKind;

// Steps by index: 0 commit, 1 edit, 2 edit, 3 commit, 4 script, 5 commit, 6 edit.
function storeSteps(kinds: EngineV3StepKind[] = [commit, edit, edit, commit, script, commit, edit]): void {
    const steps: WireEngineV3Step[] = [];
    for (const [index, kind] of kinds.entries()) {
        steps.push({ nodeId: `node-${index}`, nodeTime: `2026-06-01T09:0${index}:00Z`, kind, filesChanged: ["src/index.ts"], sentence: `step ${index}` });
    }
    storeEngineV3Steps(steps);
}

function moveMarkerToIndex(index: number): void {
    moveMarkerToNode(`node-${index}`);
}

test("test_new_steps_put_the_marker_on_the_first_commit", () => {
    // Steps: store steps, move to step 2, store steps again, expect index 0.
    storeSteps();
    moveMarkerToIndex(2);
    storeSteps();
    assert.equal(readMarkerIndex(), 0);
});

test("test_step_forward_moves_the_marker_one_step", () => {
    storeSteps();
    moveMarkerForward();
    moveMarkerForward();
    assert.equal(readMarkerIndex(), 2);
});

test("test_step_forward_on_the_last_step_stays_put", () => {
    storeSteps([commit, edit]);
    moveMarkerForward();
    moveMarkerForward();
    assert.equal(readMarkerIndex(), 1);
});

test("test_step_backwards_moves_the_marker_one_step_back", () => {
    storeSteps();
    moveMarkerToIndex(4);
    moveMarkerBackward();
    assert.equal(readMarkerIndex(), 3);
});

test("test_step_backwards_on_the_first_commit_stays_put", () => {
    storeSteps();
    moveMarkerBackward();
    assert.equal(readMarkerIndex(), 0);
});

test("test_start_over_puts_the_marker_on_the_first_commit", () => {
    storeSteps();
    moveMarkerToIndex(5);
    resetMarkerToStart();
    assert.equal(readMarkerIndex(), 0);
});

test("test_jump_to_next_commit_skips_the_steps_between", () => {
    // Steps: marker on step 1, jump to next commit, expect step 3, then step 5.
    storeSteps();
    moveMarkerToIndex(1);
    moveMarkerToNextCommit();
    assert.equal(readMarkerIndex(), 3);
    moveMarkerToNextCommit();
    assert.equal(readMarkerIndex(), 5);
});

test("test_jump_to_next_commit_with_no_later_commit_stays_put", () => {
    storeSteps();
    moveMarkerToIndex(6);
    moveMarkerToNextCommit();
    assert.equal(readMarkerIndex(), 6);
});

test("test_jump_to_previous_commit_moves_to_the_nearest_earlier_commit", () => {
    // Steps: marker on step 4, jump back, expect step 3, then step 0.
    storeSteps();
    moveMarkerToIndex(4);
    moveMarkerToPreviousCommit();
    assert.equal(readMarkerIndex(), 3);
    moveMarkerToPreviousCommit();
    assert.equal(readMarkerIndex(), 0);
});

test("test_jump_to_previous_commit_on_the_first_commit_stays_put", () => {
    storeSteps();
    moveMarkerToPreviousCommit();
    assert.equal(readMarkerIndex(), 0);
});

test("test_a_node_click_moves_the_marker_to_that_node", () => {
    storeSteps();
    moveMarkerToIndex(2);
    assert.equal(readMarkerIndex(), 2);
    assert.equal(isCurrentEngineV3Node("node-2"), true);
    assert.equal(isCurrentEngineV3Node("node-1"), false);
});

test("test_a_click_on_a_node_that_is_not_a_step_leaves_the_marker_alone", () => {
    storeSteps();
    moveMarkerForward();
    moveMarkerToNode("filler-node");
    assert.equal(readMarkerIndex(), 1);
});

test("test_the_marker_is_on_the_first_step_only_at_index_0", () => {
    storeSteps();
    assert.equal(isMarkerOnFirstStep(), true);
    moveMarkerForward();
    assert.equal(isMarkerOnFirstStep(), false);
});

test("test_the_marker_is_on_the_last_step_only_at_the_last_index", () => {
    storeSteps();
    assert.equal(isMarkerOnLastStep(), false);
    moveMarkerToIndex(6);
    assert.equal(isMarkerOnLastStep(), true);
});

test("test_a_commit_comes_after_the_marker_until_the_last_commit", () => {
    // Steps: step 5 is the last commit; step 6 comes after it.
    storeSteps();
    moveMarkerToIndex(4);
    assert.equal(containsCommitAfterMarker(), true);
    moveMarkerToIndex(5);
    assert.equal(containsCommitAfterMarker(), false);
});

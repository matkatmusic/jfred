// The pure Layer 6 node judges: each exported function gets one passing input and one failing input.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_NODES, findNodeFacts, isExpectedNodeSet, isMismatchAlone, isNodeExpected, isStateFilterAbsent,
  listNodeClasses, listNodeSignatures, listNodeSizes, listRunStateClasses, listUniqueValues,
} from "../scripts/visual/layer6-node-facts.ts";
import { MISMATCH_ID, PENDING_ID, VERIFIED_ID, type NodeFacts } from "../scripts/visual/layer6-probes.ts";

function createNode(overrides: Partial<NodeFacts>): NodeFacts {
  return {
    id: "node-a", classes: "node", width: 10, height: 20,
    borderStyle: "solid", borderColor: "red", borderWidth: "1px",
    outlineStyle: "none", outlineColor: "blue", outlineWidth: "0px", backgroundImage: "none",
    ...overrides,
  };
}

function createExpectedNodes(): NodeFacts[] {
  const nodes: NodeFacts[] = [];
  for (const expected of EXPECTED_NODES) {
    const stateClass = expected.stateClass === undefined ? "" : ` ${expected.stateClass}`;
    const neverProvableClass = expected.isNeverProvable ? " never-provable" : "";
    nodes.push(createNode({ id: expected.id, classes: `node${stateClass}${neverProvableClass}` }));
  }
  return nodes;
}

test("listRunStateClasses_keeps_only_run_state_names", () => {
  assert.deepEqual(listRunStateClasses("node run-state-verified never-provable"), ["run-state-verified"]);
});

test("listRunStateClasses_returns_nothing_without_a_run_state_name", () => {
  assert.deepEqual(listRunStateClasses("node never-provable"), []);
});

test("findNodeFacts_returns_the_node_with_the_id", () => {
  const wanted = createNode({ id: "wanted" });
  assert.equal(findNodeFacts([createNode({ id: "other" }), wanted], "wanted"), wanted);
});

test("findNodeFacts_returns_undefined_for_a_missing_id", () => {
  assert.equal(findNodeFacts([createNode({ id: "other" })], "wanted"), undefined);
});

test("isNodeExpected_accepts_the_verified_node_with_its_one_state_class", () => {
  const verified = EXPECTED_NODES.find((expected) => expected.id === VERIFIED_ID)!;
  assert.equal(isNodeExpected(createNode({ classes: "node run-state-verified" }), verified), true);
});

test("isNodeExpected_rejects_a_missing_node_and_a_wrong_state_class", () => {
  const verified = EXPECTED_NODES.find((expected) => expected.id === VERIFIED_ID)!;
  assert.equal(isNodeExpected(undefined, verified), false);
  assert.equal(isNodeExpected(createNode({ classes: "node run-state-derived" }), verified), false);
});

test("isExpectedNodeSet_accepts_the_seven_README_nodes", () => {
  assert.equal(isExpectedNodeSet(createExpectedNodes()), true);
});

test("isExpectedNodeSet_rejects_a_set_missing_one_node", () => {
  const nodes = createExpectedNodes();
  nodes.pop();
  assert.equal(isExpectedNodeSet(nodes), false);
});

test("isMismatchAlone_accepts_only_the_mismatch_node_with_double_outline_and_fill", () => {
  const nodes = [
    createNode({ id: MISMATCH_ID, outlineStyle: "double", backgroundImage: "linear-gradient(red, blue)" }),
    createNode({ id: PENDING_ID }),
  ];
  assert.equal(isMismatchAlone(nodes), true);
});

test("isMismatchAlone_rejects_a_second_node_with_the_double_outline", () => {
  const nodes = [
    createNode({ id: MISMATCH_ID, outlineStyle: "double", backgroundImage: "linear-gradient(red, blue)" }),
    createNode({ id: PENDING_ID, outlineStyle: "double" }),
  ];
  assert.equal(isMismatchAlone(nodes), false);
});

test("isStateFilterAbsent_accepts_kinds_without_state_words", () => {
  assert.equal(isStateFilterAbsent(["file", "branch"]), true);
});

test("isStateFilterAbsent_rejects_an_empty_list_and_a_state_word", () => {
  assert.equal(isStateFilterAbsent([]), false);
  assert.equal(isStateFilterAbsent(["file", "mismatch"]), false);
});

test("listNodeClasses_returns_each_class_string_in_order", () => {
  assert.deepEqual(listNodeClasses([createNode({ classes: "a b" }), createNode({ classes: "c" })]), ["a b", "c"]);
});

test("listNodeClasses_returns_nothing_for_no_nodes", () => {
  assert.deepEqual(listNodeClasses([]), []);
});

test("listNodeSizes_joins_width_and_height", () => {
  assert.deepEqual(listNodeSizes([createNode({ width: 4, height: 7 })]), ["4x7"]);
});

test("listNodeSizes_does_not_swap_width_and_height", () => {
  assert.notDeepEqual(listNodeSizes([createNode({ width: 4, height: 7 })]), ["7x4"]);
});

test("listNodeSignatures_joins_border_outline_and_background_with_bars", () => {
  assert.deepEqual(listNodeSignatures([createNode({})]), ["solid|red|1px|none|blue|0px|none"]);
});

test("listNodeSignatures_differs_when_the_outline_style_differs", () => {
  const [plain, doubled] = listNodeSignatures([createNode({}), createNode({ outlineStyle: "double" })]);
  assert.notEqual(plain, doubled);
});

test("listUniqueValues_drops_repeats_and_keeps_order", () => {
  assert.deepEqual(listUniqueValues(["a", "b", "a"]), ["a", "b"]);
});

test("listUniqueValues_keeps_a_list_that_has_no_repeats", () => {
  assert.notDeepEqual(listUniqueValues(["a", "b"]), ["a"]);
});

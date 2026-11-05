// Tests for scripts/visual/layer7-facts.ts: the pure judges, fed a good node set and then one bad answer at a time.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    BLOCK_IDS, TOOL_IDS, countNodesWithClass, findColumnNode, isApart, isBlockColourOwnAlone, isBlockComplete, isBracketBesideLane,
    isBracketSpanning, isEveryIdUnique, isLetterSetExpected, isNear, isStampedWithPredecessor, isTrackBetween, isWindowed,
    listBlockNodes, listColumnIds, listMissingIds,
    type ColumnBracketFacts, type ColumnNodeFacts,
} from "../scripts/visual/layer7-facts.ts";
import { ANNOTATION_MID_IDS, ANNOTATION_SAME_ID } from "../src/viewer_api_layer7_fixture_sessions.ts";
import { ANNOTATION_LOOKS } from "../webapp/layer1-components/session-column/layer1-annotation-looks.ts";

const LETTERS = ["u", "a", "t", "h", "m", "r", "?", "n"];
const BLOCK_COLOUR = "rgb(10, 20, 30)";
const makeNodes = (): ColumnNodeFacts[] => {
    const classes = Object.values(ANNOTATION_LOOKS).map((look) => look.cssClass);
    return BLOCK_IDS.map((id, index) => ({
        id, classes: `anode ${classes[index]}`, instant: `2026-06-01T08:${index}0:00Z`, pairId: undefined, sessionId: "s1",
        letter: LETTERS[index]!, recordLabel: "", backgroundColor: BLOCK_COLOUR, stack: 0, cx: 22, cy: 100 + index * 20,
        nodeBox: { left: 15, right: 29, top: 93 + index * 20, bottom: 107 + index * 20 },
    }));
};
const OTHER_SESSION_COLOUR = { sessionId: "s2", backgroundColor: "rgb(200, 10, 10)" };

test("test_the_expected_ids_are_8_block_ids_2_tool_ids_and_433_column_ids", () => {
    // Steps: count the three id lists, then check the mid, same-instant and ruler-row ids are in the column list.
    assert.equal(BLOCK_IDS.length, 8);
    assert.equal(TOOL_IDS.length, 2);
    assert.equal(listColumnIds().length, 433);
    assert.ok(listColumnIds().includes("l7-row-037"));
    assert.equal(BLOCK_IDS[3], "l7-block-3");
    for (const id of ANNOTATION_MID_IDS)
        assert.ok(listColumnIds().includes(id.toString()));
    assert.ok(listColumnIds().includes(ANNOTATION_SAME_ID.toString()));
    assert.ok(isEveryIdUnique([...listColumnIds(), ...TOOL_IDS]));
});

test("test_isBlockComplete_passes_the_good_set_and_fails_a_missing_id_a_doubled_id_and_a_repeated_kind_class", () => {
    assert.equal(isBlockComplete(makeNodes()), true);
    assert.equal(isBlockComplete(makeNodes().slice(1)), false);
    assert.equal(isBlockComplete([...makeNodes(), makeNodes()[0]!]), false);
    const repeated = makeNodes().map((node, index) => (index === 1 ? { ...node, classes: "anode a-user" } : node));
    assert.equal(isBlockComplete(repeated), false);
});

test("test_filler_nodes_do_not_count_toward_the_block", () => {
    const filler = { ...makeNodes()[0]!, id: "l7-fill-00" };
    assert.equal(listBlockNodes([...makeNodes(), filler]).length, 8);
    assert.equal(countNodesWithClass([...makeNodes(), filler], "a-user"), 2);
    assert.equal(countNodesWithClass(listBlockNodes([...makeNodes(), filler]), "a-user"), 1);
});

test("test_findColumnNode_returns_the_node_and_throws_for_an_id_that_is_not_drawn", () => {
    assert.equal(findColumnNode(makeNodes(), "l7-block-2").id, "l7-block-2");
    assert.throws(() => findColumnNode(makeNodes(), "l7-fill-09"), /no drawn node l7-fill-09/);
});

test("test_isTrackBetween_needs_one_sticky_element_after_the_ruler_and_before_the_stage", () => {
    const good = { count: 1, isAfterRuler: true, isBeforeStage: true, position: "sticky" };
    assert.equal(isTrackBetween(good), true);
    assert.equal(isTrackBetween({ ...good, count: 2 }), false);
    assert.equal(isTrackBetween({ ...good, isAfterRuler: false }), false);
    assert.equal(isTrackBetween({ ...good, isBeforeStage: false }), false);
    assert.equal(isTrackBetween({ ...good, position: "absolute" }), false);
});

test("test_isWindowed_needs_two_partial_sets_that_differ", () => {
    assert.equal(isWindowed({ topIds: ["a", "b"], bottomIds: ["c"], outsideCount: 0 }, 81), true);
    assert.equal(isWindowed({ topIds: ["a", "b"], bottomIds: ["b", "a"], outsideCount: 0 }, 81), false);
    assert.equal(isWindowed({ topIds: [], bottomIds: ["c"], outsideCount: 0 }, 81), false);
    const everything = listColumnIds();
    assert.equal(isWindowed({ topIds: everything, bottomIds: ["c"], outsideCount: 0 }, 81), false);
});

test("test_isBracketSpanning_needs_one_dashed_bracket_whose_ends_sit_on_the_two_centres", () => {
    const good = { count: 1, style: "dashed", top: 140, bottom: 200 };
    assert.equal(isBracketSpanning(good, 141, 199, 2), true);
    assert.equal(isBracketSpanning({ ...good, count: 0 }, 140, 200, 2), false);
    assert.equal(isBracketSpanning({ ...good, style: "solid" }, 140, 200, 2), false);
    assert.equal(isBracketSpanning({ ...good, top: 150 }, 140, 200, 2), false);
    assert.equal(isBracketSpanning({ ...good, bottom: 210 }, 140, 200, 2), false);
});

test("test_isApart_is_true_for_boxes_that_touch_and_false_for_boxes_that_overlap", () => {
    const box = { left: 10, right: 24, top: 10, bottom: 24 };
    assert.equal(isApart(box, { left: 24, right: 38, top: 10, bottom: 24 }), true);
    assert.equal(isApart(box, { left: 23, right: 37, top: 10, bottom: 24 }), false);
    assert.equal(isApart(box, { left: 10, right: 24, top: 30, bottom: 44 }), true);
});

test("test_isStampedWithPredecessor_needs_same_instant_same_height_stack_one_and_no_rect_overlap", () => {
    // Steps: the good stampless dot sits one stack step right of its predecessor; each bad answer breaks one rule.
    const predecessor = makeNodes()[6]!;
    const good = { ...predecessor, id: "l7-block-7", cx: 36, stack: 1, nodeBox: { ...predecessor.nodeBox, left: 29, right: 43 } };
    assert.equal(isStampedWithPredecessor(good, predecessor), true);
    assert.equal(isStampedWithPredecessor({ ...good, instant: "other" }, predecessor), false);
    assert.equal(isStampedWithPredecessor({ ...good, cy: predecessor.cy + 5 }, predecessor), false);
    assert.equal(isStampedWithPredecessor({ ...good, cx: predecessor.cx }, predecessor), false);
    assert.equal(isStampedWithPredecessor({ ...good, stack: 0 }, predecessor), false);
    assert.equal(isStampedWithPredecessor({ ...good, nodeBox: { ...good.nodeBox, left: 25 } }, predecessor), false);
});

test("test_isLetterSetExpected_needs_the_8_letters_u_a_t_r_h_m_n_question_mark_once_each", () => {
    assert.equal(isLetterSetExpected(makeNodes()), true);
    assert.equal(isLetterSetExpected(makeNodes().map((node) => (node.letter === "?" ? { ...node, letter: "[?]" } : node))), false);
    assert.equal(isLetterSetExpected(makeNodes().map((node) => (node.letter === "n" ? { ...node, letter: "u" } : node))), false);
    assert.equal(isLetterSetExpected(makeNodes().slice(1)), false);
});

test("test_isBlockColourOwnAlone_needs_one_block_colour_that_no_other_session_dot_uses", () => {
    // Steps: good answer, then one odd block colour, no other session, a shared colour.
    const dotColours = [{ sessionId: "s1", backgroundColor: BLOCK_COLOUR }, OTHER_SESSION_COLOUR];
    assert.equal(isBlockColourOwnAlone(makeNodes(), dotColours), true);
    const odd = makeNodes().map((node, index) => (index === 3 ? { ...node, backgroundColor: "rgb(1, 1, 1)" } : node));
    assert.equal(isBlockColourOwnAlone(odd, dotColours), false);
    assert.equal(isBlockColourOwnAlone(makeNodes(), [dotColours[0]!]), false);
    assert.equal(isBlockColourOwnAlone(makeNodes(), [...dotColours, { sessionId: "s3", backgroundColor: BLOCK_COLOUR }]), false);
});

test("test_isBracketBesideLane_needs_the_bracket_left_of_both_dots_and_right_of_the_lane_to_its_left", () => {
    // Steps: dots at x 22, box left 15; the lane to their left is at x -6.
    const bracket: ColumnBracketFacts = { count: 1, style: "dashed", top: 140, bottom: 200, left: 5, right: 13 };
    const dots = [makeNodes()[2]!, makeNodes()[5]!];
    assert.equal(isBracketBesideLane(bracket, dots, 28), true);
    assert.equal(isBracketBesideLane({ ...bracket, left: 16 }, dots, 28), false);
    assert.equal(isBracketBesideLane({ ...bracket, left: -7 }, dots, 28), false);
});

test("test_the_list_helpers_drop_repeats_and_name_what_is_missing", () => {
    assert.deepEqual(listMissingIds(["a", "b"], ["a", "c"]), ["c"]);
    assert.equal(isEveryIdUnique(["a", "b", "a"]), false);
    assert.equal(isNear(10, 12, 2), true);
    assert.equal(isNear(10, 13, 2), false);
});

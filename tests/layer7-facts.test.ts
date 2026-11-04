// Tests for scripts/visual/layer7-facts.ts: the pure judges, fed a good node set and then one bad answer at a time.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    BLOCK_IDS, TOOL_IDS, countNodesWithClass, findColumnNode, isBlockComplete, isBracketSpanning, isEveryIdUnique, isNear,
    isStampedWithPredecessor, isTrackBetween, isWindowed, listBlockNodes, listColumnIds, listDistinctSignatures, listMissingIds,
    type ColumnNodeFacts,
} from "../scripts/visual/layer7-facts.ts";
import { ANNOTATION_LOOKS } from "../webapp/layer1-annotation-looks.ts";

const makeNodes = (): ColumnNodeFacts[] => {
    const classes = Object.values(ANNOTATION_LOOKS).map((look) => look.cssClass);
    return BLOCK_IDS.map((id, index) => ({
        id, classes: `anode ${classes[index]}`, instant: `2026-06-01T08:${index}0:00Z`, pairId: undefined, cx: 22, cy: 100 + index * 20,
        borderStyle: "solid", label: "", labelBox: { left: 50, right: 100, top: 94 + index * 20, bottom: 106 + index * 20 },
        nodeBox: { left: 13, right: 31, top: 91 + index * 20, bottom: 109 + index * 20 }, signature: `look-${index}`,
    }));
};

test("the expected ids are 8 block ids, 2 tool ids and 68 column ids", () => {
    assert.equal(BLOCK_IDS.length, 8);
    assert.equal(TOOL_IDS.length, 2);
    assert.equal(listColumnIds().length, 68);
    assert.equal(BLOCK_IDS[3], "l7-block-3");
    assert.ok(isEveryIdUnique([...listColumnIds(), ...TOOL_IDS]));
});

test("isBlockComplete passes the good set and fails a missing id, a doubled id and a repeated kind class", () => {
    assert.equal(isBlockComplete(makeNodes()), true);
    assert.equal(isBlockComplete(makeNodes().slice(1)), false);
    assert.equal(isBlockComplete([...makeNodes(), makeNodes()[0]!]), false);
    const repeated = makeNodes().map((node, index) => (index === 1 ? { ...node, classes: "anode a-user" } : node));
    assert.equal(isBlockComplete(repeated), false);
});

test("filler nodes do not count toward the block", () => {
    const filler = { ...makeNodes()[0]!, id: "l7-fill-00" };
    assert.equal(listBlockNodes([...makeNodes(), filler]).length, 8);
    assert.equal(countNodesWithClass([...makeNodes(), filler], "a-user"), 2);
    assert.equal(countNodesWithClass(listBlockNodes([...makeNodes(), filler]), "a-user"), 1);
});

test("findColumnNode returns the node and throws for an id that is not drawn", () => {
    assert.equal(findColumnNode(makeNodes(), "l7-block-2").id, "l7-block-2");
    assert.throws(() => findColumnNode(makeNodes(), "l7-fill-09"), /no drawn node l7-fill-09/);
});

test("isTrackBetween needs one sticky element after the ruler and before the stage", () => {
    const good = { count: 1, isAfterRuler: true, isBeforeStage: true, position: "sticky" };
    assert.equal(isTrackBetween(good), true);
    assert.equal(isTrackBetween({ ...good, count: 2 }), false);
    assert.equal(isTrackBetween({ ...good, isAfterRuler: false }), false);
    assert.equal(isTrackBetween({ ...good, isBeforeStage: false }), false);
    assert.equal(isTrackBetween({ ...good, position: "absolute" }), false);
});

test("isWindowed needs two partial sets that differ", () => {
    assert.equal(isWindowed({ topIds: ["a", "b"], bottomIds: ["c"], outsideCount: 0 }, 68), true);
    assert.equal(isWindowed({ topIds: ["a", "b"], bottomIds: ["b", "a"], outsideCount: 0 }, 68), false);
    assert.equal(isWindowed({ topIds: [], bottomIds: ["c"], outsideCount: 0 }, 68), false);
    const everything = listColumnIds();
    assert.equal(isWindowed({ topIds: everything, bottomIds: ["c"], outsideCount: 0 }, 68), false);
});

test("isBracketSpanning needs one dashed bracket whose ends sit on the two centres", () => {
    const good = { count: 1, style: "dashed", top: 140, bottom: 200 };
    assert.equal(isBracketSpanning(good, 141, 199, 2), true);
    assert.equal(isBracketSpanning({ ...good, count: 0 }, 140, 200, 2), false);
    assert.equal(isBracketSpanning({ ...good, style: "solid" }, 140, 200, 2), false);
    assert.equal(isBracketSpanning({ ...good, top: 150 }, 140, 200, 2), false);
    assert.equal(isBracketSpanning({ ...good, bottom: 210 }, 140, 200, 2), false);
});

test("isStampedWithPredecessor needs the same instant, the same height and a different x", () => {
    const predecessor = makeNodes()[6]!;
    const good = { ...predecessor, id: "l7-block-7", cx: 38 };
    assert.equal(isStampedWithPredecessor(good, predecessor), true);
    assert.equal(isStampedWithPredecessor({ ...good, instant: "other" }, predecessor), false);
    assert.equal(isStampedWithPredecessor({ ...good, cy: predecessor.cy + 5 }, predecessor), false);
    assert.equal(isStampedWithPredecessor({ ...good, cx: predecessor.cx }, predecessor), false);
});

test("the list helpers drop repeats and name what is missing", () => {
    assert.deepEqual(listDistinctSignatures(makeNodes()).length, 8);
    assert.equal(listDistinctSignatures([makeNodes()[0]!, makeNodes()[0]!]).length, 1);
    assert.deepEqual(listMissingIds(["a", "b"], ["a", "c"]), ["c"]);
    assert.equal(isEveryIdUnique(["a", "b", "a"]), false);
    assert.equal(isNear(10, 12, 2), true);
    assert.equal(isNear(10, 13, 2), false);
});

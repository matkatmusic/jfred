// Tests for validateBubble in layer7-bubble-checks.ts, using a stateful fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import {
    isBubblePairRight, isPairIdSetRight, isToolBoxOff, isToolBoxRestored, isToolBoxRight, validateBubble,
    type BubbleToolFacts, type ClickFacts, type ToolBoxFacts,
} from "../scripts/visual/layer7-bubble-checks.ts";
import { type BracketFacts } from "../scripts/visual/layer7-facts.ts";
import {
    BUBBLE_PAIR_ID, BUBBLE_TOOL_FACTS, CLICK_TOOL_NODE, COLUMN_PAIR_ID, DISPATCHER_BUBBLE, SCROLL_HOME, SCROLL_TO_BUBBLE_PAIR, TOOL_BOX,
    TOOL_BOX_FACTS, buildBracketProbe,
} from "../scripts/visual/layer7-probes.ts";

const SHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-17-layer7-bubble-pair.png");
const BUBBLE_BRACKET = buildBracketProbe(DISPATCHER_BUBBLE, `.tbracket[data-pair-id="${BUBBLE_PAIR_ID}"]`);

const FACTS: BubbleToolFacts = {
    tnodes: [{ cx: 30, cy: 500, classes: "tnode a-tool-use" }, { cx: 30.5, cy: 560, classes: "tnode a-tool-result" }],
    dotX: 30, pageToolNodes: 2, bubbleColumnNodes: 0, pairIds: [COLUMN_PAIR_ID, BUBBLE_PAIR_ID],
};
const BRACKET: BracketFacts = { count: 1, style: "dashed", top: 500, bottom: 560 };
const BOX_ON: ToolBoxFacts = {
    exists: true, isChecked: true, label: "tool call", hiddenKinds: "edit script-run branch", otherBoxes: "edit:false,branch:false",
    toolShown: 5, columnToolShown: 1,
};
const BOX_OFF: ToolBoxFacts = { ...BOX_ON, isChecked: false, hiddenKinds: "edit script-run branch tool", toolShown: 0 };

interface Setup { facts: BubbleToolFacts; bracket: BracketFacts; boxOn: ToolBoxFacts; boxOff: ToolBoxFacts; click: ClickFacts }
const makeSetup = (change: Partial<Setup> = {}): Setup => ({
    facts: FACTS, bracket: BRACKET, boxOn: BOX_ON, boxOff: BOX_OFF, click: { isOpen: false, requests: 0 }, ...change,
});

const makeFakePage = (setup: Setup): HeadlessPage => {
    let isToolOn = true;
    const table = new Map<string, unknown>([
        [SCROLL_HOME, 0], [SCROLL_TO_BUBBLE_PAIR, undefined], [BUBBLE_TOOL_FACTS, setup.facts], [BUBBLE_BRACKET, setup.bracket],
        [CLICK_TOOL_NODE, setup.click],
    ]);
    const answerFor = (expression: string): unknown => {
        if (expression === `${TOOL_BOX}.click()`)
            isToolOn = !isToolOn;
        else if (expression === TOOL_BOX_FACTS)
            return isToolOn ? setup.boxOn : setup.boxOff;
        else if (!table.has(expression))
            throw new Error(`unexpected expression: ${expression}`);
        return table.get(expression);
    };
    return {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
    };
};

const runChecks = async (setup: Setup) => {
    const savedShot = existsSync(SHOT) ? readFileSync(SHOT) : undefined;
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    let newFailures: string[] = [];
    try {
        await validateBubble(makeFakePage(setup));
        newFailures = failures.slice(failuresBefore);
    } finally {
        console.log = log;
        failures.length = failuresBefore;
        if (savedShot === undefined)
            rmSync(SHOT, { force: true });
        else
            writeFileSync(SHOT, savedShot);
    }
    return { lines, newFailures };
};

const BUBBLE_TITLE = "L7 the dispatcher bubble holds the tool pair on its lane rail with a dashed bracket, and no other bubble does";
const OFF_TITLE = "L7 unticking tool call hides the bubble tool parts, keeps the column pair and the other boxes";

test("the bubble checks pass the good page: 6 checks and one screenshot", async () => {
    const { lines, newFailures } = await runChecks(makeSetup());
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L7")).length, 6);
    assert.ok(lines.some((line) => line.includes("mockup-17-layer7-bubble-pair.png")));
});

test("a third tool node on the page, a column node in a bubble or a node off the rail fails the bubble check", async () => {
    for (const facts of [
        { ...FACTS, pageToolNodes: 3 }, { ...FACTS, bubbleColumnNodes: 1 },
        { ...FACTS, tnodes: [FACTS.tnodes[0]!, { ...FACTS.tnodes[1]!, cx: 40 }] },
    ])
        assert.deepEqual((await runChecks(makeSetup({ facts }))).newFailures, [BUBBLE_TITLE]);
});

test("a solid or short bracket fails the bubble check", async () => {
    assert.deepEqual((await runChecks(makeSetup({ bracket: { ...BRACKET, style: "solid" } }))).newFailures, [BUBBLE_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ bracket: { ...BRACKET, bottom: 530 } }))).newFailures, [BUBBLE_TITLE]);
});

test("one pair id instead of two fails only the two-pairs check", async () => {
    const { newFailures } = await runChecks(makeSetup({ facts: { ...FACTS, pairIds: [BUBBLE_PAIR_ID] } }));
    assert.deepEqual(newFailures, ["L7 two pairs in all: one column bracket and one bubble bracket"]);
});

test("a wrong box label fails only the box check", async () => {
    const { newFailures } = await runChecks(makeSetup({ boxOn: { ...BOX_ON, label: "tools" } }));
    assert.deepEqual(newFailures, ["L7 the Show row ends with a ticked tool call box that shows its nodes and the column pair"]);
});

test("an unticked box that still shows tool parts, or hides the column pair, fails the off check", async () => {
    assert.deepEqual((await runChecks(makeSetup({ boxOff: { ...BOX_OFF, toolShown: 2 } }))).newFailures, [OFF_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ boxOff: { ...BOX_OFF, columnToolShown: 0 } }))).newFailures, [OFF_TITLE]);
    assert.deepEqual((await runChecks(makeSetup({ boxOff: { ...BOX_OFF, otherBoxes: "edit:true" } }))).newFailures, [OFF_TITLE]);
});

test("the restore judge refuses fewer tool parts and a tool kind that is still hidden", () => {
    assert.equal(isToolBoxRestored(BOX_ON, BOX_ON), true);
    assert.equal(isToolBoxRestored(BOX_ON, { ...BOX_ON, toolShown: 3 }), false);
    assert.equal(isToolBoxRestored(BOX_ON, { ...BOX_ON, hiddenKinds: "tool" }), false);
    assert.equal(isToolBoxRestored(BOX_ON, { ...BOX_ON, isChecked: false }), false);
});

test("a click that opens the drawer or sends a request fails only the click check", async () => {
    const title = "L7 a click on a tool node opens no drawer and sends no request";
    assert.deepEqual((await runChecks(makeSetup({ click: { isOpen: true, requests: 0 } }))).newFailures, [title]);
    assert.deepEqual((await runChecks(makeSetup({ click: { isOpen: false, requests: 2 } }))).newFailures, [title]);
});

test("the judges read the pair, the id set and the box state", () => {
    assert.equal(isBubblePairRight(FACTS, BRACKET), true);
    assert.equal(isBubblePairRight({ ...FACTS, tnodes: [] }, BRACKET), false);
    assert.equal(isPairIdSetRight([COLUMN_PAIR_ID, BUBBLE_PAIR_ID, COLUMN_PAIR_ID]), true);
    assert.equal(isPairIdSetRight([COLUMN_PAIR_ID]), false);
    assert.equal(isToolBoxRight(BOX_ON), true);
    assert.equal(isToolBoxRight(BOX_OFF), false);
    assert.equal(isToolBoxOff(BOX_ON, BOX_OFF), true);
});

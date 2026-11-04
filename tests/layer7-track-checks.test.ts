// Tests for validateTrack and validateColumnNodes in layer7-track-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { buildRulerMatchProbe } from "../scripts/visual/layer4-probes.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import {
    BLOCK_IDS, TOOL_IDS, listColumnIds, type BracketFacts, type ColumnNodeFacts, type DuplicateFacts, type TrackFacts, type WindowFacts,
} from "../scripts/visual/layer7-facts.ts";
import {
    COLUMN_NODE_FACTS, COLUMN_PAIR_ID, DUPLICATE_FACTS, FULL_SCROLL_IDS, SCROLL_HOME, TRACK_FACTS, WINDOW_FACTS,
    buildBracketProbe, buildHideSettled, buildRecordDot, buildSetHideIgnored,
} from "../scripts/visual/layer7-probes.ts";
import { validateColumnNodes, validateTrack } from "../scripts/visual/layer7-track-checks.ts";
import { ANNOTATION_LOOKS } from "../webapp/layer1-annotation-looks.ts";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";

const SHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-15-layer7-column.png");
const STAMPLESS_TITLE = "L7 the stampless node shares its predecessor instant, is level with it, sits beside it and its label does not overlap";
const COLUMN_BRACKET =buildBracketProbe("document", `#annotation-track .abracket[data-pair-id="${COLUMN_PAIR_ID}"]`);

interface Answers { track: TrackFacts; nodes: ColumnNodeFacts[]; window: WindowFacts; seen: string[]; duplicates: DuplicateFacts; unmatched: string[]; bracket: BracketFacts }
const stampless = (node: ColumnNodeFacts): ColumnNodeFacts => ({
    ...node, instant: "t6", cy: 220, cx: 38, classes: `${node.classes} is-stampless`,
    labelBox: { left: 50, right: 120, top: 227, bottom: 239 }, nodeBox: { left: 29, right: 47, top: 211, bottom: 229 },
});
const makeGoodNodes = (): ColumnNodeFacts[] => {
    const classes = [WireRecordKind.user, WireRecordKind.assistant, WireRecordKind.toolUse, WireRecordKind.attachment,
        WireRecordKind.permissionMode, WireRecordKind.toolResult, WireRecordKind.unknown, WireRecordKind.customTitle]
        .map((kind) => ANNOTATION_LOOKS[kind].cssClass);
    return BLOCK_IDS.map((id, index) => ({
        id, classes: `anode ${classes[index]}`, instant: `t${index}`, pairId: index === 2 || index === 5 ? COLUMN_PAIR_ID : undefined,
        cx: 22, cy: 100 + index * 20, borderStyle: index === 6 ? "dashed" : "solid", label: index === 6 ? "[?] worktree-state" : "",
        labelBox: { left: 50, right: 120, top: 94 + index * 20, bottom: 106 + index * 20 }, signature: `look-${index}`,
        nodeBox: { left: 13, right: 31, top: 91 + index * 20, bottom: 109 + index * 20 },
    })).map((node, index) => (index === 7 ? stampless(node) : node));
};
const makeAnswers = (change: Partial<Answers> = {}): Answers => ({
    track: { count: 1, isAfterRuler: true, isBeforeStage: true, position: "sticky" }, nodes: makeGoodNodes(),
    window: { topIds: ["a", "b"], bottomIds: ["c"], outsideCount: 0 }, seen: listColumnIds(),
    duplicates: { stageParts: 0, trackTools: 0, ids: [...BLOCK_IDS, ...TOOL_IDS] }, unmatched: [],
    bracket: { count: 1, style: "dashed", top: 140, bottom: 200 }, ...change,
});

const makeFakePage = (answers: Answers): HeadlessPage => {
    const table = new Map<string, unknown>([
        [SCROLL_HOME, 0], [TRACK_FACTS, answers.track], [COLUMN_NODE_FACTS, answers.nodes], [WINDOW_FACTS, answers.window],
        [FULL_SCROLL_IDS, answers.seen], [DUPLICATE_FACTS, answers.duplicates], [COLUMN_BRACKET, answers.bracket],
        [buildSetHideIgnored(false), undefined], [buildSetHideIgnored(true), undefined],
    ]);
    for (const id of [...BLOCK_IDS, ...TOOL_IDS])
        table.set(buildRulerMatchProbe(buildRecordDot(id)), !answers.unmatched.includes(id));
    const answerFor = (expression: string): unknown => {
        if (!table.has(expression))
            throw new Error(`unexpected expression: ${expression}`);
        return table.get(expression);
    };
    return {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async (expression: string) => { assert.ok(expression === buildHideSettled(true) || expression === buildHideSettled(false)); },
        navigate: async () => {}, screenshot: async () => "", close: async () => {},
    };
};

const runChecks = async (answers: Answers) => {
    const savedShot = existsSync(SHOT) ? readFileSync(SHOT) : undefined;
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    let newFailures: string[] = [];
    try {
        const page = makeFakePage(answers);
        await validateTrack(page);
        await validateColumnNodes(page);
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

test("the track checks pass the good fixture page: 13 checks and one screenshot", async () => {
    const { lines, newFailures } = await runChecks(makeAnswers());
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L7")).length, 13);
    assert.ok(lines.some((line) => line.includes("mockup-15-layer7-column.png")));
});

const failuresFor = async (change: Partial<Answers>) => (await runChecks(makeAnswers(change))).newFailures;

test("a second column element, a node outside the margin or every record drawn fails only its own check", async () => {
    const track = { count: 2, isAfterRuler: true, isBeforeStage: true, position: "sticky" };
    assert.deepEqual(await failuresFor({ track }), ["L7 the session column is one sticky element between the ruler and the stage"]);
    assert.deepEqual(await failuresFor({ window: { topIds: ["a"], bottomIds: ["c"], outsideCount: 3 } }),
        ["L7 every drawn column node lies inside the pane plus the margin"]);
    assert.deepEqual(await failuresFor({ window: { topIds: listColumnIds(), bottomIds: ["c"], outsideCount: 0 } }),
        ["L7 the column draws fewer than 68 nodes at the top and at the bottom, and the two sets differ"]);
});

test("a full scroll that misses a record fails only the full-scroll check", async () => {
    assert.deepEqual(await failuresFor({ seen: listColumnIds().slice(1) }), ["L7 a full scroll draws all 68 column records"]);
});

test("a stage copy fails the duplicate check and a column id also in the tool ids fails the distinct check", async () => {
    const stage = { stageParts: 1, trackTools: 0, ids: [...BLOCK_IDS, ...TOOL_IDS] };
    assert.deepEqual(await failuresFor({ duplicates: stage }),
        ["L7 no record is drawn twice: none in the stage, no tool node in the column, unique ids"]);
    const overlap = await failuresFor({ seen: [...listColumnIds(), TOOL_IDS[0]!] });
    assert.deepEqual(overlap, ["L7 the column ids and the tool ids make 71 different records"]);
});

test("a node off its ruler tick fails only the ruler check", async () => {
    const newFailures = await failuresFor({ unmatched: [TOOL_IDS[1]!] });
    assert.deepEqual(newFailures, ["L7 every block node and both tool nodes sit level with a ruler tick"]);
});

const failuresWithNode = async (at: number, change: Partial<ColumnNodeFacts>) => {
    const nodes = makeGoodNodes().map((node, index) => (index === at ? { ...node, ...change } : node));
    return (await runChecks(makeAnswers({ nodes }))).newFailures;
};

test("two nodes with one look, or a solid [?] ring, fail only their own check", async () => {
    assert.deepEqual(await failuresWithNode(1, { signature: "look-0" }), ["L7 the 8 block nodes have 8 different computed looks"]);
    assert.deepEqual(await failuresWithNode(6, { borderStyle: "solid" }), ["L7 the [?] node reads [?] worktree-state and has a dashed ring"]);
});

test("a stampless node on a new row, with a label over its predecessor label, or with no label box fails only the stampless check", async () => {
    assert.deepEqual(await failuresWithNode(7, { cy: 260 }), [STAMPLESS_TITLE]);
    assert.deepEqual(await failuresWithNode(7, { labelBox: { left: 50, right: 120, top: 214, bottom: 226 } }), [STAMPLESS_TITLE]);
    assert.deepEqual(await failuresWithNode(7, { labelBox: { left: 0, right: 0, top: 0, bottom: 0 } }), [STAMPLESS_TITLE]);
    // The old CSS put the [?] label at 34px, under the stacked diamond that spans 29-47px.
    assert.deepEqual(await failuresWithNode(6, { labelBox: { left: 34, right: 120, top: 214, bottom: 226 } }), [STAMPLESS_TITLE]);
});

test("a bracket that ends short fails the pair check and the bracket-kept check", async () => {
    assert.deepEqual(await failuresFor({ bracket: { count: 1, style: "dashed", top: 140, bottom: 170 } }), [
        "L7 the column tool pair: two nodes, one pair id, 40px apart, a dashed bracket spanning them, the hook between",
        "L7 the column bracket stays when ignored nodes are hidden",
    ]);
});

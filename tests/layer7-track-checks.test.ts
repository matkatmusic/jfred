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
    BLOCK_IDS, TOOL_IDS, listColumnIds,
    type ColumnBracketFacts, type ColumnNodeFacts, type DuplicateFacts, type SessionDotColour, type TrackFacts, type WindowFacts,
} from "../scripts/visual/layer7-facts.ts";
import {
    COLUMN_NODE_FACTS, COLUMN_PAIR_ID, DUPLICATE_FACTS, FULL_SCROLL_IDS, SCROLL_HOME, SESSION_DOT_COLOURS, TRACK_FACTS, TRACK_LABEL_COUNT,
    WINDOW_FACTS, buildBracketProbe, buildHideSettled, buildRecordDot, buildSetHideIgnored,
} from "../scripts/visual/layer7-probes.ts";
import { validateColumnNodes, validateTrack } from "../scripts/visual/layer7-track-checks.ts";
import { ANNOTATION_LOOKS } from "../webapp/layer1-components/session-column/layer1-annotation-looks.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

const SHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-15-layer7-column.png");
const LOOKS_TITLE = "L7 the 8 block dots show the letters u a t r h m n ?, share one session colour, and no other session uses it";
const UNKNOWN_TITLE = "L7 the unknown dot reads exactly ?, carries the worktree-state log text, and the column draws no .alabel label";
const STAMPLESS_TITLE = "L7 the stampless dot shares its predecessor instant, is level with it, sits beside it at stack 1 with no dot overlap";
const PAIR_TITLE = "L7 the column tool pair: two dots, one pair id, 40px apart, a dashed bracket spanning them and left of both, the hook between";
const KEPT_TITLE = "L7 the column bracket stays, beside its lane, when ignored nodes are hidden";
const COLUMN_BRACKET = buildBracketProbe("document", `#annotation-track .abracket[data-pair-id="${COLUMN_PAIR_ID}"]`);
const BLOCK_COLOUR = "rgb(10, 20, 30)";

interface Answers {
    track: TrackFacts; nodes: ColumnNodeFacts[]; window: WindowFacts; seen: string[]; duplicates: DuplicateFacts; unmatched: string[];
    bracket: ColumnBracketFacts; colours: SessionDotColour[]; labelCount: number;
}
const stampless = (node: ColumnNodeFacts): ColumnNodeFacts => ({
    ...node, instant: "t6", cy: 220, cx: 36, stack: 1, classes: `${node.classes} is-stampless`,
    nodeBox: { left: 29, right: 43, top: 213, bottom: 227 },
});
const makeGoodNodes = (): ColumnNodeFacts[] => {
    const classes = [WireRecordKind.user, WireRecordKind.assistant, WireRecordKind.toolUse, WireRecordKind.attachment,
        WireRecordKind.permissionMode, WireRecordKind.toolResult, WireRecordKind.unknown, WireRecordKind.customTitle]
        .map((kind) => ANNOTATION_LOOKS[kind].cssClass);
    const letters = ["u", "a", "t", "h", "m", "r", "?", "n"];
    return BLOCK_IDS.map((id, index) => ({
        id, classes: `anode ${classes[index]}`, instant: `t${index}`, pairId: index === 2 || index === 5 ? COLUMN_PAIR_ID : undefined,
        sessionId: "s1", letter: letters[index]!, recordLabel: index === 6 ? "worktree-state" : "", backgroundColor: BLOCK_COLOUR, stack: 0,
        cx: 22, cy: 100 + index * 20, nodeBox: { left: 15, right: 29, top: 93 + index * 20, bottom: 107 + index * 20 },
    })).map((node, index) => (index === 7 ? stampless(node) : node));
};
const makeAnswers = (change: Partial<Answers> = {}): Answers => ({
    track: { count: 1, isAfterRuler: true, isBeforeStage: true, position: "sticky" }, nodes: makeGoodNodes(),
    window: { topIds: ["a", "b"], bottomIds: ["c"], outsideCount: 0 }, seen: listColumnIds(),
    duplicates: { stageParts: 0, trackTools: 0, ids: [...BLOCK_IDS, ...TOOL_IDS] }, unmatched: [],
    bracket: { count: 1, style: "dashed", top: 140, bottom: 200, left: 7, right: 13 },
    colours: [{ sessionId: "s1", backgroundColor: BLOCK_COLOUR }, { sessionId: "s2", backgroundColor: "rgb(200, 10, 10)" }], labelCount: 0, ...change,
});

const makeFakePage = (answers: Answers): HeadlessPage => {
    const table = new Map<string, unknown>([
        [SCROLL_HOME, 0], [TRACK_FACTS, answers.track], [COLUMN_NODE_FACTS, answers.nodes], [WINDOW_FACTS, answers.window],
        [FULL_SCROLL_IDS, answers.seen], [DUPLICATE_FACTS, answers.duplicates], [COLUMN_BRACKET, answers.bracket],
        [SESSION_DOT_COLOURS, answers.colours], [TRACK_LABEL_COUNT, answers.labelCount],
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

test("test_the_track_checks_pass_the_good_fixture_page_with_13_checks_and_one_screenshot", async () => {
    const { lines, newFailures } = await runChecks(makeAnswers());
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L7")).length, 13);
    assert.ok(lines.some((line) => line.includes("mockup-15-layer7-column.png")));
});

const failuresFor = async (change: Partial<Answers>) => (await runChecks(makeAnswers(change))).newFailures;

test("test_a_second_column_element_a_node_outside_the_margin_or_every_record_drawn_fails_only_its_own_check", async () => {
    const track = { count: 2, isAfterRuler: true, isBeforeStage: true, position: "sticky" };
    assert.deepEqual(await failuresFor({ track }), ["L7 the session column is one sticky element between the ruler and the stage"]);
    assert.deepEqual(await failuresFor({ window: { topIds: ["a"], bottomIds: ["c"], outsideCount: 3 } }),
        ["L7 every drawn column node lies inside the pane plus the margin"]);
    assert.deepEqual(await failuresFor({ window: { topIds: listColumnIds(), bottomIds: ["c"], outsideCount: 0 } }),
        ["L7 the column draws fewer than 433 nodes at the top and at the bottom, and the two sets differ"]);
});

test("test_a_full_scroll_that_misses_a_record_fails_only_the_full_scroll_check", async () => {
    assert.deepEqual(await failuresFor({ seen: listColumnIds().slice(1) }), ["L7 a full scroll draws all 433 column records"]);
});

test("test_a_stage_copy_fails_the_duplicate_check_and_a_column_id_also_in_the_tool_ids_fails_the_distinct_check", async () => {
    const stage = { stageParts: 1, trackTools: 0, ids: [...BLOCK_IDS, ...TOOL_IDS] };
    assert.deepEqual(await failuresFor({ duplicates: stage }),
        ["L7 no record is drawn twice: none in the stage, no tool node in the column, unique ids"]);
    const overlap = await failuresFor({ seen: [...listColumnIds(), TOOL_IDS[0]!] });
    assert.deepEqual(overlap, ["L7 the column ids and the tool ids make 436 different records"]);
});

test("test_a_node_off_its_ruler_tick_fails_only_the_ruler_check", async () => {
    const newFailures = await failuresFor({ unmatched: [TOOL_IDS[1]!] });
    assert.deepEqual(newFailures, ["L7 every block node and both tool nodes sit level with a ruler tick"]);
});

const failuresWithNode = async (at: number, change: Partial<ColumnNodeFacts>) => {
    const nodes = makeGoodNodes().map((node, index) => (index === at ? { ...node, ...change } : node));
    return (await runChecks(makeAnswers({ nodes }))).newFailures;
};

test("test_a_wrong_letter_a_second_block_colour_or_a_colour_shared_with_another_session_fails_only_the_looks_check", async () => {
    // Steps: a bracketed letter, a dot with its own colour, then another session that uses the block colour.
    assert.deepEqual(await failuresWithNode(1, { letter: "[a]" }), [LOOKS_TITLE]);
    assert.deepEqual(await failuresWithNode(1, { backgroundColor: "rgb(1, 1, 1)" }), [LOOKS_TITLE]);
    const shared = [{ sessionId: "s1", backgroundColor: BLOCK_COLOUR }, { sessionId: "s2", backgroundColor: BLOCK_COLOUR }];
    assert.deepEqual(await failuresFor({ colours: shared }), [LOOKS_TITLE]);
});

test("test_a_bracketed_unknown_dot_a_missing_log_text_or_an_alabel_fails_the_unknown_check", async () => {
    assert.deepEqual(await failuresWithNode(6, { letter: "[?]" }), [LOOKS_TITLE, UNKNOWN_TITLE]);
    assert.deepEqual(await failuresWithNode(6, { recordLabel: "other" }), [UNKNOWN_TITLE]);
    assert.deepEqual(await failuresFor({ labelCount: 3 }), [UNKNOWN_TITLE]);
});

test("test_a_stampless_dot_on_a_new_row_at_stack_zero_or_over_its_predecessor_fails_only_the_stampless_check", async () => {
    assert.deepEqual(await failuresWithNode(7, { cy: 260 }), [STAMPLESS_TITLE]);
    assert.deepEqual(await failuresWithNode(7, { stack: 0 }), [STAMPLESS_TITLE]);
    assert.deepEqual(await failuresWithNode(7, { nodeBox: { left: 25, right: 39, top: 213, bottom: 227 } }), [STAMPLESS_TITLE]);
});

test("test_extra_tool_use_dots_between_rows_do_not_fail_the_pair_check_but_a_wrong_pair_class_does", async () => {
    // Steps: an extra mid tool-use dot passes; the use dot with the result class fails.
    const mid = { ...makeGoodNodes()[2]!, id: "l7-mid-02", pairId: undefined };
    assert.deepEqual(await failuresFor({ nodes: [...makeGoodNodes(), mid] }), []);
    const failed = await failuresWithNode(2, { classes: "anode a-tool-result" });
    assert.deepEqual(failed, ["L7 the 8 block records each have one node and each kind class appears once", PAIR_TITLE]);
});

test("test_a_bracket_that_ends_short_fails_the_pair_check_and_the_bracket_kept_check", async () => {
    assert.deepEqual(await failuresFor({ bracket: { count: 1, style: "dashed", top: 140, bottom: 170, left: 7, right: 13 } }), [PAIR_TITLE, KEPT_TITLE]);
});

test("test_a_bracket_over_a_dot_or_back_in_the_lane_to_the_left_fails_the_pair_check_and_the_bracket_kept_check", async () => {
    // Dots start at x 15; the left lane is at x 5. Left 16 hits a dot.
    const bracket = { count: 1, style: "dashed", top: 140, bottom: 200, right: 13 };
    assert.deepEqual(await failuresFor({ bracket: { ...bracket, left: 16 } }), [PAIR_TITLE, KEPT_TITLE]);
    assert.deepEqual(await failuresFor({ bracket: { ...bracket, left: 4 } }), [PAIR_TITLE, KEPT_TITLE]);
});

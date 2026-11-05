// Tests for scripts/visual/ruler-ui-session-run.ts: the session column page steps on a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ANNOTATION_BLOCK_IDS, listFillerIds } from "../src/viewer_api_layer7_fixture_data.ts";
import { ANNOTATION_MID_IDS, ANNOTATION_SAME_ID, FIXTURE_LOG_SESSIONS } from "../src/viewer_api_layer7_fixture_sessions.ts";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { findSessionEndIds } from "../scripts/visual/layer7-session-ends.ts";
import { COLUMN_PAIR_ID, SCROLL_HOME, buildBracketProbe, buildRecordDot } from "../scripts/visual/layer7-probes.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import {
    COLOUR_FACTS, OFF_FACTS, QUIET_FACTS, SESSION_FACTS, SESSION_SCAN, SESSION_TOGGLE_CLICK, STAGE_LEFT, TICK_TEXT_FACTS,
    buildDotCentre, buildHoverProbe, buildLineProbe, buildMidProbe, buildSameInstantProbe, buildScrollToDot,
} from "../scripts/visual/ruler-ui-probes.ts";
import { EXPECTED_COLOURED_TICKS, FIRST_ID, FIRST_SESSION_ID } from "../scripts/visual/ruler-ui-session-checks.ts";
import { validateSessionOff, validateSessionState } from "../scripts/visual/ruler-ui-session-run.ts";

const SHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-23-ruler-session.png");
const ENDS = findSessionEndIds(FIXTURE_LOG_SESSIONS[0]!.id);
const FILL_8 = String(listFillerIds()[8]);
const FILL_40 = String(listFillerIds()[40]);
const USE_ID = String(ANNOTATION_BLOCK_IDS[2]);
const DOT = { left: 200, right: 214, top: 100, bottom: 114 };
const OFF_LEFT = 398;
const LINE = { laneX: "18px", top: 100, bottom: 900, dotCy: 100 };
const TITLES = {
    stage: "RULER session: the stage moves right by exactly the track width",
    lineEnd: "RULER session: the first session line ends at its last dot",
    off: "RULER session off: the track is gone, --track-w is 0px, and the stage is back",
};

const makeGoodTable = (): Map<string, unknown> => new Map<string, unknown>([
    [SCROLL_HOME, 0], [STAGE_LEFT, OFF_LEFT], [SESSION_TOGGLE_CLICK, 0], [QUIET_FACTS, { errors: 0, isIdle: true }],
    [buildScrollToDot(FILL_8), true], [buildScrollToDot(ENDS.lastId), true], [buildScrollToDot(FILL_40), true], [buildScrollToDot(String(ANNOTATION_MID_IDS[0])), true],
    [SESSION_FACTS, { isCurrent: true, background: "rgb(25, 158, 112)", trackLeft: 384, trackWidth: 74, rulerRight: 384, stageLeft: 472, laneXs: ["18px", "35px", "52px"] }],
    [SESSION_SCAN, {
        letters: ["u", "a"], titled: 0, alabels: 0, colours: [["c1"], ["c2"], ["c3"], ["c4"]],
        coloured: Array.from({ length: EXPECTED_COLOURED_TICKS }, () => ({ computed: "rgb(1, 1, 1)", expected: "rgb(1, 1, 1)" })),
    }],
    [buildLineProbe(FIRST_SESSION_ID, FIRST_ID), LINE], [buildLineProbe(FIRST_SESSION_ID, ENDS.lastId), { ...LINE, dotCy: 900 }],
    [buildLineProbe(String(FIXTURE_LOG_SESSIONS[3]!.id), FILL_40), LINE],
    [buildSameInstantProbe(String(listFillerIds()[7]), String(ANNOTATION_SAME_ID)), {
        first: DOT, second: { ...DOT, left: 228, right: 242 }, tickClasses: "tick multi", tickColor: "rgb(5, 5, 5)", plainColor: "rgb(5, 5, 5)",
    }],
    [buildMidProbe(String(ANNOTATION_MID_IDS[0])), { minGap: 6, isBetween: true }],
    [buildBracketProbe("document", `.abracket[data-pair-id="${COLUMN_PAIR_ID}"]`), { count: 1, style: "dashed", top: 140, bottom: 200 }],
    [buildDotCentre(USE_ID), 140], [buildDotCentre(String(ANNOTATION_BLOCK_IDS[5])), 200],
    [buildHoverProbe(buildRecordDot(USE_ID)), {
        isVisible: true, box: { left: 222, right: 400, top: 90, bottom: 120 }, background: "rgb(1, 2, 3)", targetBackground: "rgb(1, 2, 3)", target: DOT,
        lines: [FIXTURE_LOG_SESSIONS[0]!.title, "Bash: npm test"], hasTitle: false, isHiddenAfter: true,
    }],
    [OFF_FACTS, { trackCount: 0, trackWidth: "0px", stageLeft: OFF_LEFT }], [COLOUR_FACTS, { coloured: 0, withProperty: 0 }],
    [TICK_TEXT_FACTS, { leaders: 1, ticks: [{ time: "06-01-2026:09:00", count: "(2)", fullTime: "06-01 09:00:00.000", title: "06-01 09:00:00.000" }] }],
]);

const makeFakePage = (table: Map<string, unknown>): HeadlessPage => ({
    evaluate: async <T>(expression: string) => {
        if (!table.has(expression))
            throw new Error(`unexpected expression: ${expression}`);
        return table.get(expression) as T;
    },
    waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
});

// The state run writes an empty screenshot; put the old file back unless a newer one has replaced it.
const runWithShotGuard = async (run: () => Promise<void>) => {
    const savedShot = existsSync(SHOT) ? readFileSync(SHOT) : undefined;
    await run();
    const isOurEmptyFile = savedShot !== undefined && statSync(SHOT).size === 0;
    if (isOurEmptyFile)
        writeFileSync(SHOT, savedShot);
};

const runSteps = async (change: [string, unknown][], runStep: (page: HeadlessPage) => Promise<unknown>) => {
    const table = makeGoodTable();
    for (const [expression, answer] of change)
        table.set(expression, answer);
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    try {
        await runWithShotGuard(async () => { await runStep(makeFakePage(table)); });
    } finally {
        console.log = log;
    }
    const newFailures = failures.slice(failuresBefore);
    failures.length = failuresBefore;
    return { lines, newFailures };
};

const runState = (change: [string, unknown][] = []) => runSteps(change, validateSessionState);
const runOff = (change: [string, unknown][] = []) => runSteps(change, (page) => validateSessionOff(page, OFF_LEFT));

test("test_the_good_fake_page_passes_the_14_session_state_checks_and_returns_the_off_left", async () => {
    const { lines, newFailures } = await runState();
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  RULER")).length, 14);
});

test("test_a_stage_that_moved_less_than_the_track_fails_only_the_stage_check", async () => {
    const facts = { isCurrent: true, background: "rgb(25, 158, 112)", trackLeft: 384, trackWidth: 74, rulerRight: 384, stageLeft: 400, laneXs: ["18px", "35px", "52px"] };
    assert.deepEqual((await runState([[SESSION_FACTS, facts]])).newFailures, [TITLES.stage]);
});

test("test_a_session_line_that_stops_short_of_its_last_dot_fails_only_the_line_end_check", async () => {
    const shortLine = { ...LINE, dotCy: 950 };
    assert.deepEqual((await runState([[buildLineProbe(FIRST_SESSION_ID, ENDS.lastId), shortLine]])).newFailures, [TITLES.lineEnd]);
});

test("test_session_off_passes_when_the_track_is_gone_and_fails_with_a_track_left_over", async () => {
    assert.deepEqual((await runOff()).newFailures, []);
    const leftOver = { trackCount: 1, trackWidth: "74px", stageLeft: OFF_LEFT };
    assert.deepEqual((await runOff([[OFF_FACTS, leftOver]])).newFailures, [TITLES.off]);
});

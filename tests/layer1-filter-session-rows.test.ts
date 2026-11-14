// Expected pixels are hand-derived: node floor 22 per ladder row, plus SESSION_DOT_PX per dot line, plus the spacer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLayer1ViewByTargets, computeRelaidLayer1View } from "../webapp/layer1-components/show-row/layer1-filter.ts";
import { SESSION_DOT_PX, SESSION_ROW_SPACER_PX, type SessionDotInstants } from "../webapp/layer1-components/ruler/layer1-session-dot-counts.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { T0, T1, T2, findPair } from "./layer1-filter-test-helpers.ts";

const NODE_ROW_PX = 22;

function buildCommitAndDiskPair(path: string, commitInstant: string, diskInstant: string) {
    return { path, commits: [{ hash: "aa", instant: commitInstant, axisPx: 0 }], onDisk: { instant: diskInstant, axisPx: 0 } };
}

function buildView(pairs: WireLayer1View["pairs"]): WireLayer1View {
    return { pairs, gitOrphans: [], diskOrphans: [], ruler: [] };
}

function buildSessionDots(instantsMs: number[]): SessionDotInstants {
    return new Map([["session-a", instantsMs]]);
}

function listTickAxisPx(view: WireLayer1View): number[] {
    const axisPxs: number[] = [];
    for (const tick of view.ruler) {
        axisPxs.push(tick.axisPx);
    }
    return axisPxs;
}

function listTickDotBlocks(view: WireLayer1View): (number | undefined)[] {
    const blocks: (number | undefined)[] = [];
    for (const tick of view.ruler) {
        blocks.push(tick.dotBlockPx);
    }
    return blocks;
}

const T0_MS = Date.parse(T0);
const T1_MS = Date.parse(T1);
const THREE_DOTS_AFTER_T0 = buildSessionDots([T0_MS + 1000, T0_MS + 2000, T0_MS + 3000]);

test("test_session_dots_push_the_next_row_below_the_dots_of_the_row_above", () => {
    // Scenario: one pair with ticks T0 and T1; session A has three dots between them.
    const view = buildView([buildCommitAndDiskPair("src/keep/a.ts", T0, T1)]);
    // Without dots, the second tick is one node row (22) below the first.
    assert.deepEqual(listTickAxisPx(computeRelaidLayer1View(view)), [0, NODE_ROW_PX]);
    // With dots, the second tick moves down by three dot lines plus the spacer.
    const relaid = computeRelaidLayer1View(view, undefined, THREE_DOTS_AFTER_T0);
    assert.deepEqual(listTickAxisPx(relaid), [0, NODE_ROW_PX + 3 * SESSION_DOT_PX + SESSION_ROW_SPACER_PX]);
});

test("test_relayout_without_session_dots_gives_todays_axis_px", () => {
    // Scenario: the same view laid out with and without an explicit undefined for the dots.
    const view = buildView([buildCommitAndDiskPair("src/keep/a.ts", T0, T1)]);
    const withoutArgument = computeRelaidLayer1View(view);
    const withUndefined = computeRelaidLayer1View(view, undefined, undefined);
    // Both are identical, and today's axis (0, 22) is kept.
    assert.deepEqual(withUndefined, withoutArgument);
    assert.deepEqual(listTickAxisPx(withUndefined), [0, NODE_ROW_PX]);
    // No tick carries the session marker.
    assert.deepEqual(listTickDotBlocks(withUndefined), [undefined, undefined]);
    for (const tick of withUndefined.ruler) {
        assert.equal("dotBlockPx" in tick, false);
    }
});

test("test_bubble_nodes_stay_level_with_their_tick_in_session_layout", () => {
    // Scenario: pair a spans T0 and T1; pair b has a commit and a disk node both at T0 (slots 0 and 1).
    const view = buildView([
        buildCommitAndDiskPair("src/keep/a.ts", T0, T1),
        buildCommitAndDiskPair("src/keep/b.ts", T0, T0),
    ]);
    const twoDots = buildSessionDots([T0_MS + 1000, T0_MS + 2000]);
    const relaid = computeRelaidLayer1View(view, undefined, twoDots);
    // Node floor at T0 is two rows (44), plus two dot lines (28), plus the spacer.
    const secondTickAxisPx = 2 * NODE_ROW_PX + 2 * SESSION_DOT_PX + SESSION_ROW_SPACER_PX;
    assert.deepEqual(listTickAxisPx(relaid), [0, secondTickAxisPx]);
    // Each node sits at its tick plus slot x 22.
    const pairA = findPair(relaid, "src/keep/a.ts");
    const pairB = findPair(relaid, "src/keep/b.ts");
    assert.equal(pairA.commits[0]!.axisPx, 0);
    assert.equal(pairA.onDisk.axisPx, secondTickAxisPx);
    assert.equal(pairB.commits[0]!.axisPx, 0);
    assert.equal(pairB.onDisk.axisPx, NODE_ROW_PX);
});

test("test_filtering_a_row_away_folds_its_dots_into_the_row_before", () => {
    // Scenario: ticks T0, T1, T2. Only the dropped pair owns T1. Session A has 1 dot after T0 and 2 dots after T1.
    const view = buildView([
        buildCommitAndDiskPair("src/keep/a.ts", T0, T2),
        buildCommitAndDiskPair("src/drop/c.ts", T1, T1),
    ]);
    const dots = buildSessionDots([T0_MS + 1000, T1_MS + 1000, T1_MS + 2000]);
    // Unfiltered, the rows hold 1 and 2 dot lines, and the last row holds none.
    const unfiltered = filterLayer1ViewByTargets(view, undefined, undefined, dots);
    assert.deepEqual(listTickDotBlocks(unfiltered), [SESSION_DOT_PX, 2 * SESSION_DOT_PX, 0]);
    // With the middle tick filtered away, the first row holds all three dot lines.
    const filtered = filterLayer1ViewByTargets(view, ["src/keep/a.ts"], undefined, dots);
    assert.deepEqual(listTickDotBlocks(filtered), [3 * SESSION_DOT_PX, 0]);
});

test("test_the_open_row_adds_its_list_height_on_top_of_the_session_gap", () => {
    // Scenario: the row of T0 is open with a 100 px file list; session A has three dots in that row.
    const view = buildView([buildCommitAndDiskPair("src/keep/a.ts", T0, T1)]);
    const expansion = { instantMs: T0_MS, listHeightPx: 100 };
    const relaid = computeRelaidLayer1View(view, expansion, THREE_DOTS_AFTER_T0);
    // The second tick sits one session gap plus the list height below the first.
    const sessionGapPx = NODE_ROW_PX + 3 * SESSION_DOT_PX + SESSION_ROW_SPACER_PX;
    assert.deepEqual(listTickAxisPx(relaid), [0, sessionGapPx + 100]);
});

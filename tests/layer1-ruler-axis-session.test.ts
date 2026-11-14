// Session layout: a tick's gap is node floor + dot block + spacer, with no time term.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RULER_NODE_ROW_PIXELS,
    computeNodeLadderLayout,
} from "../webapp/layer1-components/ruler/layer1-ruler-axis.ts";
import {
    SESSION_DOT_PX,
    SESSION_ROW_SPACER_PX,
    type SessionDotInstants,
} from "../webapp/layer1-components/ruler/layer1-session-dot-counts.ts";

const HOUR_MS = 60 * 60 * 1000;
const BASE_MS = Date.UTC(2026, 6, 25, 12, 0, 0);

function makeInstantAtHour(hours: number): Date {
    return new Date(BASE_MS + hours * HOUR_MS);
}

function makeLadderAtHours(hourOffsets: number[]): Date[] {
    const ladder: Date[] = [];
    for (const hours of hourOffsets) {
        ladder.push(makeInstantAtHour(hours));
    }
    return ladder;
}

// One session with `dotCount` dots one second apart, starting `secondsAfterBase` seconds after the base moment.
function makeSessionDots(sessionId: string, dotCount: number, secondsAfterBase: number): SessionDotInstants {
    const dotMs: number[] = [];
    for (let dotIndex = 0; dotIndex < dotCount; dotIndex++) {
        dotMs.push(BASE_MS + (secondsAfterBase + dotIndex) * 1000);
    }
    return new Map([[sessionId, dotMs]]);
}

test("test_session_gap_is_the_node_floor_plus_the_dot_block_plus_the_spacer", () => {
    // Two ticks one hour apart, one node each; session A has 3 dots between them.
    const ladders = [makeLadderAtHours([0, 1])];
    const sessionDots = makeSessionDots("A", 3, 10);
    // Lay out with the session dots.
    const layout = computeNodeLadderLayout(ladders, new Map(), undefined, sessionDots);
    // The second tick sits one node row + three dot lines + the spacer below the first.
    const gapPx = layout.ticks[1]!.offsetPx - layout.ticks[0]!.offsetPx;
    assert.equal(gapPx, RULER_NODE_ROW_PIXELS + 3 * SESSION_DOT_PX + SESSION_ROW_SPACER_PX);
    assert.equal(gapPx, 22 + 42 + 6);
});

test("test_session_gap_does_not_depend_on_elapsed_time", () => {
    // The same three dots, once with the second tick 1 hour later and once 100 hours later.
    const sessionDots = makeSessionDots("A", 3, 10);
    const nearLayout = computeNodeLadderLayout([makeLadderAtHours([0, 1])], new Map(), undefined, sessionDots);
    const farLayout = computeNodeLadderLayout([makeLadderAtHours([0, 100])], new Map(), undefined, sessionDots);
    // Both second ticks land at the same offset.
    assert.equal(nearLayout.ticks[1]!.offsetPx, farLayout.ticks[1]!.offsetPx);
});

test("test_session_gap_uses_the_busiest_ladder_rows_as_the_node_floor", () => {
    // One ladder has three nodes at the first instant, so the node floor there is 3 x 22 = 66.
    const ladders = [makeLadderAtHours([0, 0, 0, 1])];
    // Session A has one dot between the two ticks.
    const sessionDots = makeSessionDots("A", 1, 10);
    const layout = computeNodeLadderLayout(ladders, new Map(), undefined, sessionDots);
    // The gap is 66 + one dot line + the spacer.
    const gapPx = layout.ticks[1]!.offsetPx - layout.ticks[0]!.offsetPx;
    assert.equal(gapPx, 3 * RULER_NODE_ROW_PIXELS + SESSION_DOT_PX + SESSION_ROW_SPACER_PX);
    assert.equal(gapPx, 66 + 14 + 6);
});

test("test_without_session_dots_the_layout_is_unchanged", () => {
    // Same ladders laid out with no fourth argument and with an explicit undefined.
    const ladders = [makeLadderAtHours([0, 8, 100])];
    const plainLayout = computeNodeLadderLayout(ladders);
    const undefinedDotsLayout = computeNodeLadderLayout(ladders, new Map(), undefined, undefined);
    // The two results are equal.
    assert.deepEqual(undefinedDotsLayout, plainLayout);
    // No tick carries a dotBlockPx key.
    for (const tick of undefinedDotsLayout.ticks) {
        assert.equal("dotBlockPx" in tick, false);
    }
});

test("test_each_session_tick_reports_its_dot_block", () => {
    // Session A has 3 dots between the two ticks; nothing falls after the last tick.
    const ladders = [makeLadderAtHours([0, 1])];
    const sessionDots = makeSessionDots("A", 3, 10);
    const layout = computeNodeLadderLayout(ladders, new Map(), undefined, sessionDots);
    // The first tick reports 3 lines of dots, the last reports none.
    assert.equal(layout.ticks[0]!.dotBlockPx, 42);
    assert.equal(layout.ticks[1]!.dotBlockPx, 0);
});

test("test_expansion_height_adds_on_top_of_the_session_gap", () => {
    // Same two ticks and three dots; the first tick also asks for 40 extra px.
    const ladders = [makeLadderAtHours([0, 1])];
    const sessionDots = makeSessionDots("A", 3, 10);
    const extraGapPx = new Map<number, number>([[makeInstantAtHour(0).getTime(), 40]]);
    const layout = computeNodeLadderLayout(ladders, extraGapPx, undefined, sessionDots);
    // The gap is the session gap (22 + 42 + 6) plus the 40 extra px.
    const gapPx = layout.ticks[1]!.offsetPx - layout.ticks[0]!.offsetPx;
    assert.equal(gapPx, 22 + 42 + 6 + 40);
});

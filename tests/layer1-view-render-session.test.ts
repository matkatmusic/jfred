// Task 907: the session button spaces the ruler rows by their session dot blocks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installRecordingFetch } from "./layer1-drawer-test-helpers.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot against a throwaway DOM.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
const { clearFolderFilterState, renderLayer1View } = await import("../webapp/layer1-view-render.ts");

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const NODE_FLOOR_PX = 22;
const DOT_PX = 14;
const SPACER_PX = 6;
// Row T0 holds up to 3 dots of one session; row T1 holds up to 2.
const FIRST_ROW_MINIMUM_GAP_PX = NODE_FLOOR_PX + 3 * DOT_PX + SPACER_PX;
const SECOND_ROW_MINIMUM_GAP_PX = NODE_FLOOR_PX + 2 * DOT_PX + SPACER_PX;

function buildDot(id: string, sessionId: string, instant: string, line: number): WireAnnotation {
    return { id, kind: WireRecordKind.user, instant, label: id, sessionId, sessionTitle: `title ${sessionId}`, sessionFile: `/x/${sessionId}.jsonl`, line };
}

function buildSessionView(): unknown {
    const annotations = [
        buildDot("a1", "s1", "2026-07-01T10:10:00.000Z", 1),
        buildDot("a2", "s1", "2026-07-01T10:20:00.000Z", 2),
        buildDot("a3", "s1", "2026-07-01T10:30:00.000Z", 3),
        buildDot("b1", "s2", "2026-07-01T10:15:00.000Z", 1),
        buildDot("b2", "s2", "2026-07-01T11:10:00.000Z", 2),
        buildDot("b3", "s2", "2026-07-01T11:20:00.000Z", 3),
    ];
    return {
        pairs: [
            { path: "src/a.ts", commits: [{ hash: "aa", instant: T0, axisPx: 0 }], onDisk: { instant: T1, axisPx: 22 } },
            { path: "src/b.ts", commits: [{ hash: "ba", instant: T0, axisPx: 0 }], onDisk: { instant: T2, axisPx: 44 } },
        ],
        gitOrphans: [],
        diskOrphans: [],
        ruler: [{ instant: T0, axisPx: 0, eventCount: 2 }, { instant: T1, axisPx: 22, eventCount: 1 }, { instant: T2, axisPx: 44, eventCount: 1 }],
        annotations,
    };
}

async function flushPageWork(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
}

async function openSessionPage(): Promise<void> {
    initLayer1Dom();
    initLayer1Page();
    installRecordingFetch(() => ({ steps: [] }));
    clearFolderFilterState();
    await renderLayer1View(buildSessionView() as never);
}

async function clickSessionButton(): Promise<void> {
    document.getElementById("session-toggle")!.click();
    await flushPageWork();
}

function listTickAxisPx(): number[] {
    const axisPxList: number[] = [];
    for (const tick of document.querySelectorAll<HTMLElement>("#timelineRulerComponent .tick")) {
        axisPxList.push(Number(tick.style.getPropertyValue("--axis-px")));
    }
    return axisPxList;
}

function listGapsBetween(axisPxList: readonly number[]): number[] {
    const gaps: number[] = [];
    for (let index = 1; index < axisPxList.length; index++) {
        gaps.push(axisPxList[index]! - axisPxList[index - 1]!);
    }
    return gaps;
}

async function selectOnlyFileA(): Promise<void> {
    const row = document.querySelector<HTMLElement>(`#filenav-tree .file-item[title="src/a.ts"]`)!;
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
    document.getElementById("filenav-only-selected")!.click();
    await flushPageWork();
}

test("test_turning_the_session_button_on_spaces_the_ruler_rows_by_their_dot_blocks", async () => {
    // Scenario: one session has 3 dots in the first row and another has 2 in the second row; the rows must leave room for those dots.
    // Open the page with three ruler rows.
    await openSessionPage();
    assert.equal(listTickAxisPx().length, 3);
    // Press the session button.
    await clickSessionButton();
    // The first row leaves room for 3 dot lines; the second row for 2 dot lines.
    const gaps = listGapsBetween(listTickAxisPx());
    assert.equal(gaps.length, 2);
    assert.ok(gaps[0]! >= FIRST_ROW_MINIMUM_GAP_PX, `first gap ${gaps[0]}`);
    assert.ok(gaps[1]! >= SECOND_ROW_MINIMUM_GAP_PX, `second gap ${gaps[1]}`);
});

test("test_turning_the_session_button_off_gives_back_todays_row_positions", async () => {
    // Scenario: on then off puts every ruler row back where it was before the first press.
    // Open the page and note where the rows are.
    await openSessionPage();
    const rowsBefore = listTickAxisPx();
    // Press the session button: the rows must move apart.
    await clickSessionButton();
    assert.notDeepEqual(listTickAxisPx(), rowsBefore);
    // Press it again: the rows return to the first positions.
    await clickSessionButton();
    assert.deepEqual(listTickAxisPx(), rowsBefore);
});

test("test_a_folder_filter_while_the_button_is_on_keeps_the_session_spacing", async () => {
    // Scenario: the user turns the session button on, then shows only src/a.ts; the first row still leaves room for 3 dot lines.
    // Open the page and press the session button.
    await openSessionPage();
    await clickSessionButton();
    // Select src/a.ts and press "only selected".
    await selectOnlyFileA();
    // The filtered ruler still spaces its first row by its dot block.
    const gaps = listGapsBetween(listTickAxisPx());
    assert.equal(gaps.length, 1);
    assert.ok(gaps[0]! >= FIRST_ROW_MINIMUM_GAP_PX, `first gap ${gaps[0]}`);
});

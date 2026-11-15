// Task 382: the shared session column draws only the records near the viewport, once per page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { installRecordingFetch, waitForPendingFetches } from "./layer1-drawer-test-helpers.ts";
import { WireRecordKind } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-components/session-column/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { registerSessionRelayout, storeAnnotations,renderAnnotationTrack, toggleSessionDotLines } = await import("../webapp/layer1-components/session-column/layer1-annotation-track.ts");

const { moveDetailsPaneToRightEdge, moveOpenDetailsPane } = await import("../webapp/layer1-components/details-drawer/layer1-details-pane.ts");
const { renderJfredStrip } = await import("../webapp/layer1-components/commits-column/layer1-jfred-strip.ts");
const { setArmed } = await import("../webapp/layer1-components/commits-column/layer1-jfred-state.ts");
const { BarsViewMode, setBarsViewMode } = await import("../webapp/layer1-components/bars-view/layer1-bars-mode.ts");

const RECORD_COUNT = 70;
const TICK_SPACING_PX = 50;

// Tick k is k hours after the first and 50 px further down the axis.
function buildTicks(): WireRulerTick[] {
    const ticks: WireRulerTick[] = [];
    for (let index = 0; index < RECORD_COUNT; index++) {
        const instant = new Date(Date.parse("2026-06-01T00:00:00Z") + index * 3600_000).toISOString();
        ticks.push({ instant, axisPx: index * TICK_SPACING_PX, eventCount: 1 });
    }
    return ticks;
}

function buildRecords(ticks: WireRulerTick[]): WireAnnotation[] {
    return ticks.map((tick, index) => ({
        id: `r-${index}`, kind: WireRecordKind.user, instant: tick.instant, label: `prompt ${index}`, sessionId: "s1", sessionTitle: "first", sessionFile: "/x/s1.jsonl", line: 1000 + index,
    }));
}

function buildSessionRecord(id: string, kind: WireRecordKind, instant: string, sessionId: string): WireAnnotation {
    return { id, kind, instant, label: id, sessionId, sessionTitle: `title ${sessionId}`, sessionFile: `/x/${sessionId}.jsonl`, line: 1000 };
}

function readDrawnIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>("#sessionDotLinesComponent .anode")].map((node) => node.dataset["recordId"]!);
}

// A renderLayer1View in an earlier test leaves the page's stage redraw registered; these tests need the plain time-layout track redraw.
function useTrackOnlyRelayout(ticks: WireRulerTick[]): void {
    registerSessionRelayout(async () => {
        renderAnnotationTrack(ticks);
        moveOpenDetailsPane();
    });
}

// storeAnnotations turns the column off, so every render starts with it off.
function renderRecords(records: WireAnnotation[], ticks: WireRulerTick[], shouldShowSession = true): void {
    initLayer1Dom();
    storeAnnotations({ annotations: records });
    useTrackOnlyRelayout(ticks);
    renderAnnotationTrack(ticks);
    if (shouldShowSession) {
        // A demo view has its instants stored, so the toggle finishes inside the call.
        void toggleSessionDotLines();
    }
}

test("test_the_column_draws_fewer_nodes_than_records", () => {
    // Scenario: 70 records spread over 3450 px; a viewport at the top draws only those inside the margin.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    const drawn = readDrawnIds().length;
    assert.ok(drawn > 0);
    assert.ok(drawn < RECORD_COUNT);
});

test("test_scrolling_draws_the_records_near_the_new_position", () => {
    // Scenario: the pane scrolls to 2000 px; the scroll listener swaps the drawn ids.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    const atTop = readDrawnIds();
    const pane = document.getElementById("timelineContainer")!;
    pane.scrollTop = 2000;
    pane.dispatchEvent(new window.Event("scroll"));
    const afterScroll = readDrawnIds();
    assert.ok(afterScroll.includes("r-40"));
    assert.ok(!afterScroll.includes("r-0"));
    assert.notDeepEqual(afterScroll, atTop);
});

test("test_the_track_is_the_sibling_right_after_the_ruler", () => {
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    const track = document.getElementById("sessionDotLinesComponent")!;
    assert.equal(document.getElementById("timelineRulerComponent")!.nextElementSibling, track);
    // assert.equal(track.nextElementSibling, document.getElementById("fileBubbleContainer"));
    assert.equal(track.parentElement, document.getElementById("timelineRulerContainer"));
    assert.ok(track.classList.contains("sessionDotLinesComponent"));
});

test("test_a_second_render_keeps_one_track", () => {
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    renderAnnotationTrack(ticks);
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent").length, 1);
});

test("test_no_annotations_leave_no_track_and_remove_an_old_one", () => {
    // Scenario: real data has no annotations, so nothing is built; a track from a fixture view goes away.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    storeAnnotations({});
    renderAnnotationTrack(ticks);
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
});

test("test_empty_ticks_draw_nothing", () => {
    renderRecords(buildRecords(buildTicks()), [], false);
    assert.equal(document.querySelectorAll(".anode").length, 0);
});

test("test_a_node_carries_its_record_attributes_and_label", () => {
    // Scenario: an ignored, stampless tool_use record prints its letter, class, flags and title.
    const ticks = buildTicks();
    const record: WireAnnotation = {
        id: "x-1", kind: WireRecordKind.toolUse, instant: ticks[1]!.instant, label: "Bash: npm test",
        isIgnored: true, isStampless: true, pairId: "toolu-1", sessionId: "s1", sessionTitle: "first", sessionFile: "/x/s1.jsonl", line: 1000,
    };
    renderRecords([record], ticks);
    const node = document.querySelector<HTMLElement>("#sessionDotLinesComponent .anode")!;
    assert.ok(node.classList.contains("a-tool-use"));
    assert.ok(node.classList.contains("is-ignored"));
    assert.ok(node.classList.contains("is-stampless"));
    assert.equal(node.dataset["recordKind"], "tool_use");
    assert.equal(node.dataset["pairId"], "toolu-1");
    assert.equal(node.dataset["instant"], record.instant);
    assert.equal(node.style.getPropertyValue("--axis-px"), "50");
    assert.equal(node.dataset["recordLabel"], "Bash: npm test");
    assert.equal(node.textContent, "t");
    assert.equal(node.hasAttribute("title"), false);
    assert.equal(document.querySelector("#sessionDotLinesComponent .alabel"), null);
});

test("test_the_column_bracket_joins_the_pair_and_survives_hiding", () => {
    // Scenario: tool_use at 50 px, tool_result at 250 px; the bracket spans them and hiding ignored nodes leaves it.
    const ticks = buildTicks();
    const records: WireAnnotation[] = [
        { ...buildSessionRecord("u", WireRecordKind.toolUse, ticks[1]!.instant, "s1"), pairId: "p" },
        { ...buildSessionRecord("m", WireRecordKind.attachment, ticks[2]!.instant, "s1"), isIgnored: true },
        { ...buildSessionRecord("r", WireRecordKind.toolResult, ticks[5]!.instant, "s1"), pairId: "p" },
    ];
    renderRecords(records, ticks);
    document.querySelector(".appWindow")!.setAttribute("data-hide-ignored", "");
    const bracket = document.querySelector<HTMLElement>("#sessionDotLinesComponent .abracket")!;
    assert.equal(bracket.dataset["pairId"], "p");
    assert.equal(bracket.style.getPropertyValue("--axis-px"), "50");
    assert.equal(bracket.style.getPropertyValue("--span-px"), "200");
    assert.equal(bracket.style.getPropertyValue("--lane-x"), "18px");
});

test("test_a_view_without_annotations_leaves_no_track_and_no_hide_control", () => {
    // Scenario: the real builder never sets annotations, so renderLayer1View adds neither column nor control.
    initLayer1Dom();
    initLayer1Page();
    renderLayer1View({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: buildTicks() } as never);
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    assert.equal(document.getElementById("hide-ignored"), null);
});

test("test_a_view_with_annotations_gets_a_track_through_the_render_after_the_button_click", async () => {
    const ticks = buildTicks();
    initLayer1Dom();
    initLayer1Page();
    // A view with annotations makes the engineV3 bar fetch its steps.
    installRecordingFetch(() => ({ steps: [] }));
    // The page's redraw lays the ruler out again from the bubbles, so the view needs orphans to keep ticks.
    const gitOrphans = [{ path: "src/a.ts", instant: ticks[0]!.instant, axisPx: 0 }, { path: "src/b.ts", instant: ticks[1]!.instant, axisPx: 50 }];
    renderLayer1View({ pairs: [], gitOrphans, diskOrphans: [], ruler: ticks, annotations: buildRecords(ticks) } as never);
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent").length, 0);
    document.getElementById("session-toggle")!.click();
    await waitForPendingFetches();
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent").length, 1);
});

test("test_a_view_without_annotations_has_no_session_ui", () => {
    // Gate A: the real page gets none of the new session parts.
    initLayer1Dom();
    initLayer1Page();
    renderLayer1View({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: buildTicks() } as never);
    for (const selector of ["#ruler-head", ".ruler-sessions", "[data-full-time]", ".ttime", ".tcount", "#hover-popup", ".sline"]) {
        assert.equal(document.querySelector(selector), null, selector);
    }
});

test("test_by_default_there_is_a_head_and_a_session_button_in_the_view_controls_and_no_track", () => {
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    assert.ok(document.querySelector("#timelineRulerComponent > #ruler-head"));
    assert.equal(document.querySelector("#ruler-head button"), null);
    const button = document.querySelector("#timelineViewControls > button#session-toggle")!;
    assert.equal(button.textContent, "session");
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    assert.equal(document.querySelector<HTMLElement>(".sessionDataContainer")!.style.getPropertyValue("--track-w"), "0px");
});

test("test_the_button_builds_the_track_with_the_computed_width_and_a_second_click_removes_it", () => {
    // One session needs one lane: 18 + 22 = 40 px.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    document.getElementById("session-toggle")!.click();
    assert.ok(document.getElementById("sessionDotLinesComponent")!.querySelector(":scope > .ahead"));
    assert.equal(document.querySelector<HTMLElement>(".sessionDataContainer")!.style.getPropertyValue("--track-w"), "40px");
    assert.ok(document.getElementById("session-toggle")!.classList.contains("current"));
    document.getElementById("session-toggle")!.click();
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    assert.equal(document.querySelector<HTMLElement>(".sessionDataContainer")!.style.getPropertyValue("--track-w"), "0px");
});

test("test_dots_of_one_session_share_a_color_and_overlapping_sessions_take_two_lanes", () => {
    const ticks = buildTicks();
    const records = [
        buildSessionRecord("a1", WireRecordKind.user, ticks[1]!.instant, "s1"),
        buildSessionRecord("b1", WireRecordKind.user, ticks[2]!.instant, "s2"),
        buildSessionRecord("a2", WireRecordKind.user, ticks[3]!.instant, "s1"),
        buildSessionRecord("b2", WireRecordKind.user, ticks[4]!.instant, "s2"),
    ];
    renderRecords(records, ticks);
    const readColor = (id: string): string => document.querySelector<HTMLElement>(`[data-record-id="${id}"]`)!.style.getPropertyValue("--session-color");
    assert.equal(readColor("a1"), readColor("a2"));
    assert.notEqual(readColor("a1"), readColor("b1"));
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent .sline").length, 2);
    assert.equal(document.querySelector<HTMLElement>(".sessionDataContainer")!.style.getPropertyValue("--track-w"), "57px");
});

test("test_a_dot_popup_shows_the_session_title_then_the_log_line_in_the_session_color", () => {
    const ticks = buildTicks();
    renderRecords([{ ...buildSessionRecord("p1", WireRecordKind.toolUse, ticks[1]!.instant, "s1"), label: "Bash: npm test" }], ticks);
    const dot = document.querySelector<HTMLElement>("#sessionDotLinesComponent .anode")!;
    dot.dispatchEvent(new window.Event("mouseover", { bubbles: true }));
    const popup = document.getElementById("hover-popup")!;
    assert.deepEqual([...popup.querySelectorAll(".hp-line")].map((line) => line.textContent), ["title s1", "Bash: npm test"]);
    assert.equal(popup.style.backgroundColor, dot.style.getPropertyValue("--session-color"));
});

test("test_track_built_after_the_strip_is_placed_between_ruler_and_strip", async () => {
    // Scenario: the commits strip exists first, then the session button builds the track.
    // Build the page with annotations but leave the session lines off, so no track exists yet.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    // Turn on Commit mode and draw the strip, so the strip exists before the track.
    // K6: the column strip draws only in the Bubbles view.
    setBarsViewMode(BarsViewMode.bubbles);
    setArmed(true);
    renderJfredStrip(ticks);
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    // Build the track by showing the session lines.
    await toggleSessionDotLines();
    // The ruler container holds exactly: minimap, ruler, track, strip, in that order.
    const rulerContainer = document.getElementById("timelineRulerContainer")!;
    assert.deepEqual([...rulerContainer.children].map((child) => child.id), ["minimapComponent", "timelineRulerComponent", "sessionDotLinesComponent", "jfredCommitsDrawerComponent"]);
    // Leave Commit mode off and the Bars view on for the other tests in this file.
    setArmed(false);
    setBarsViewMode(BarsViewMode.bars);
});

test("test_the_session_button_is_inside_the_timeline_view_controls", () => {
    // Build a view with annotations.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    // The session button is a direct child of the view controls.
    const button = document.getElementById("session-toggle")!;
    assert.equal(button.parentElement, document.getElementById("timelineViewControls"));
});

test("test_the_session_button_is_hidden_when_the_view_has_no_annotations", () => {
    // Build a view with annotations, then store none and render the track again.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    storeAnnotations({});
    renderAnnotationTrack(ticks);
    // The button stays in the page but is hidden.
    assert.equal(document.getElementById("session-toggle")!.hidden, true);
});

test("test_the_session_button_shows_when_the_view_has_annotations", () => {
    // Build a view with annotations.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    // The button is not hidden.
    assert.equal(document.getElementById("session-toggle")!.hidden, false);
});

test("test_clicking_the_session_button_adds_the_session_dot_lines_and_marks_the_button_current", () => {
    // Build a view with annotations and the session lines off.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    // Click the button.
    document.getElementById("session-toggle")!.click();
    // The dot lines appear and the button is marked current.
    assert.equal(document.querySelectorAll("#sessionDotLinesComponent").length, 1);
    assert.ok(document.getElementById("session-toggle")!.classList.contains("current"));
});

test("test_clicking_the_session_button_twice_removes_the_session_dot_lines", () => {
    // Build a view with annotations and the session lines off.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    // Click the button twice.
    document.getElementById("session-toggle")!.click();
    document.getElementById("session-toggle")!.click();
    // The dot lines are gone and the button is not current.
    assert.equal(document.getElementById("sessionDotLinesComponent"), null);
    assert.equal(document.getElementById("session-toggle")!.classList.contains("current"), false);
});

test("test_an_open_details_pane_gets_narrower_when_the_session_lines_go_on", async () => {
    // Build a view with annotations, the session lines off and the details pane open.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    const pane = document.getElementById("detailsPaneContainer")!;
    pane.classList.add("open");
    // The scroll box is 1200 px wide; the ruler ends at 200 px and the session lines would end at 300 px.
    const scrollBox = document.getElementById("timelineContainer")!;
    Object.defineProperty(scrollBox, "clientWidth", { configurable: true, value: 1200 });
    Object.defineProperty(scrollBox, "clientHeight", { configurable: true, value: 600 });
    const rightEdgeById: Record<string, number> = { timelineRulerComponent: 200, sessionDotLinesComponent: 300, timelineContainer: 0 };
    const prototype = window.Element.prototype;
    const originalGetBoundingClientRect = prototype.getBoundingClientRect;
    prototype.getBoundingClientRect = function (this: Element): DOMRect {
        const edge = rightEdgeById[this.id] ?? 0;
        const left = this.id === "timelineContainer" ? 0 : edge;
        return { left, right: edge, top: 0, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON() { return {}; } } as DOMRect;
    };
    try {
        // With the lines off the pane is 35% of (1200 - 200).
        moveDetailsPaneToRightEdge();
        assert.equal(pane.style.width, "350px");
        // Turning the lines on re-places the open pane: 35% of (1200 - 300).
        await toggleSessionDotLines();
        assert.equal(pane.style.width, "315px");
    } finally {
        prototype.getBoundingClientRect = originalGetBoundingClientRect;
        // Leave the session lines off for the other tests in this file.
        await toggleSessionDotLines();
    }
});

test("test_the_session_button_click_moves_the_minimap", () => {
    // Build a view with annotations and the session lines off.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks, false);
    // The ruler container now ends at 321 px.
    const rulerContainer = document.getElementById("timelineRulerContainer")!;
    const fullRect = { left: 0, right: 321, top: 0, bottom: 0, width: 321, height: 0, x: 0, y: 0, toJSON() { return {}; } };
    Object.defineProperty(rulerContainer, "getBoundingClientRect", { configurable: true, value: () => fullRect });
    // Click the button.
    document.getElementById("session-toggle")!.click();
    // The minimap left edge is the new ruler container edge.
    assert.equal(document.getElementById("minimapComponent")!.style.left, "321px");
});

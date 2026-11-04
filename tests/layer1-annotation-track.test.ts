// Task 382: the shared session column draws only the records near the viewport, once per page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import { WireRecordKind } from "../webapp/layer1-wire-annotations.ts";
import type { WireAnnotation } from "../webapp/layer1-wire-annotations.ts";
import type { WireRulerTick } from "../webapp/layer1-wire.ts";

// layer1-page.ts boots at MODULE SCOPE, so absorb that first boot here against a throwaway DOM.
initLayer1Dom();
const { initLayer1Page } = await import("../webapp/layer1-page.ts");
const { renderLayer1View } = await import("../webapp/layer1-view-render.ts");
const { rememberAnnotations, renderAnnotationTrack } = await import("../webapp/layer1-annotation-track.ts");

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
    return ticks.map((tick, index) => ({ id: `r-${index}`, kind: WireRecordKind.user, instant: tick.instant, label: `prompt ${index}` }));
}

function readDrawnIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>("#annotation-track .anode")].map((node) => node.dataset["recordId"]!);
}

function renderRecords(records: WireAnnotation[], ticks: WireRulerTick[]): void {
    initLayer1Dom();
    rememberAnnotations({ annotations: records });
    renderAnnotationTrack(ticks);
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
    const pane = document.getElementById("timelines")!;
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
    const track = document.getElementById("annotation-track")!;
    assert.equal(document.getElementById("ruler")!.nextElementSibling, track);
    assert.equal(track.nextElementSibling, document.getElementById("stage"));
    assert.ok(track.classList.contains("atrack"));
});

test("test_a_second_render_keeps_one_track", () => {
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    renderAnnotationTrack(ticks);
    assert.equal(document.querySelectorAll("#annotation-track").length, 1);
});

test("test_no_annotations_leave_no_track_and_remove_an_old_one", () => {
    // Scenario: real data has no annotations, so nothing is built; a track from a fixture view goes away.
    const ticks = buildTicks();
    renderRecords(buildRecords(ticks), ticks);
    rememberAnnotations({});
    renderAnnotationTrack(ticks);
    assert.equal(document.getElementById("annotation-track"), null);
});

test("test_empty_ticks_draw_nothing", () => {
    renderRecords(buildRecords(buildTicks()), []);
    assert.equal(document.querySelectorAll(".anode").length, 0);
});

test("test_a_node_carries_its_record_attributes_and_label", () => {
    // Scenario: an ignored, stampless tool_use record prints its letter, class, flags and title.
    const ticks = buildTicks();
    const record: WireAnnotation = {
        id: "x-1", kind: WireRecordKind.toolUse, instant: ticks[1]!.instant, label: "Bash: npm test",
        isIgnored: true, isStampless: true, pairId: "toolu-1",
    };
    renderRecords([record], ticks);
    const node = document.querySelector<HTMLElement>("#annotation-track .anode")!;
    assert.ok(node.classList.contains("a-tool-use"));
    assert.ok(node.classList.contains("is-ignored"));
    assert.ok(node.classList.contains("is-stampless"));
    assert.equal(node.dataset["recordKind"], "tool_use");
    assert.equal(node.dataset["pairId"], "toolu-1");
    assert.equal(node.dataset["instant"], record.instant);
    assert.equal(node.style.getPropertyValue("--axis-px"), "50");
    assert.match(node.title, /no timestamp: placed at the previous record/);
    assert.equal(document.querySelector("#annotation-track .alabel")!.textContent, "[t] Bash: npm test");
});

test("test_the_column_bracket_joins_the_pair_and_survives_hiding", () => {
    // Scenario: tool_use at 50 px, tool_result at 250 px; the bracket spans them and hiding ignored nodes leaves it.
    const ticks = buildTicks();
    const records: WireAnnotation[] = [
        { id: "u", kind: WireRecordKind.toolUse, instant: ticks[1]!.instant, label: "a", pairId: "p" },
        { id: "m", kind: WireRecordKind.attachment, instant: ticks[2]!.instant, label: "b", isIgnored: true },
        { id: "r", kind: WireRecordKind.toolResult, instant: ticks[5]!.instant, label: "c", pairId: "p" },
    ];
    renderRecords(records, ticks);
    document.querySelector(".viz-root")!.setAttribute("data-hide-ignored", "");
    const bracket = document.querySelector<HTMLElement>("#annotation-track .abracket")!;
    assert.equal(bracket.dataset["pairId"], "p");
    assert.equal(bracket.style.getPropertyValue("--axis-px"), "50");
    assert.equal(bracket.style.getPropertyValue("--span-px"), "200");
});

test("test_a_view_without_annotations_leaves_no_track_and_no_hide_control", () => {
    // Scenario: the real builder never sets annotations, so renderLayer1View adds neither column nor control.
    initLayer1Dom();
    initLayer1Page();
    renderLayer1View({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: buildTicks() } as never);
    assert.equal(document.getElementById("annotation-track"), null);
    assert.equal(document.getElementById("hide-ignored"), null);
});

test("test_a_view_with_annotations_gets_a_track_through_the_render", () => {
    const ticks = buildTicks();
    initLayer1Dom();
    initLayer1Page();
    renderLayer1View({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: ticks, annotations: buildRecords(ticks) } as never);
    assert.equal(document.querySelectorAll("#annotation-track").length, 1);
});

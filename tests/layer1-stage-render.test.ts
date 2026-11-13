// The Layer 1 stage render: the crumb counts, the empty state, and both orphan buckets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

initLayer1Dom();
const { renderLayer1Stage } = await import("../webapp/layer1-components/bubbles/layer1-stage-render.ts");

const T0 = "2026-07-01T10:00:00.000Z";

function buildOrphan(path: string): object {
    return { path, instant: T0, axisPx: 0 };
}

test("test_an_empty_view_draws_the_empty_message_and_zero_counts", async () => {
    // Scenario: an empty view shows the empty message and zero counts.
    initLayer1Dom();
    await renderLayer1Stage({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never);
    assert.equal(document.getElementById("crumb")!.textContent, "0 pairs · 0 repo-only · 0 disk-only");
    assert.equal(document.querySelectorAll("#fileBubbleContainer .nopairs").length, 1);
});

test("test_both_orphan_buckets_follow_the_pairs", async () => {
    // Scenario: repo-only files and disk-only files each get their own bucket after the pair widgets.
    initLayer1Dom();
    await renderLayer1Stage({
        pairs: [],
        gitOrphans: [buildOrphan("a.ts")],
        diskOrphans: [buildOrphan("b.ts")],
        ruler: [],
    } as never);
    assert.equal(document.getElementById("crumb")!.textContent, "0 pairs · 1 repo-only · 1 disk-only");
    const stageText = document.getElementById("fileBubbleContainer")!.textContent!;
    assert.ok(stageText.indexOf("No on-disk match") < stageText.indexOf("No repository match"));
});

test("test_an_only_widget_is_the_whole_stage_with_no_empty_message", async () => {
    // Scenario: given an only-widget, the stage holds exactly that widget; an empty view adds no message and no bucket.
    initLayer1Dom();
    const onlyWidget = document.createElement("div");
    onlyWidget.className = "only-widget";
    await renderLayer1Stage({ pairs: [], gitOrphans: [buildOrphan("a.ts")], diskOrphans: [], ruler: [] } as never, onlyWidget);
    const stage = document.getElementById("fileBubbleContainer")!;
    const bubbleChildren = Array.from(stage.children).filter((child) => child.id !== "detailsPaneContainer");
    assert.equal(bubbleChildren.length, 1);
    assert.equal(bubbleChildren[0], onlyWidget);
    assert.equal(stage.querySelectorAll(".nopairs").length, 0);
});

test("test_given_ruler_rows_the_gutter_and_leaders_draw_one_per_row", async () => {
    // Scenario: ruler rows handed to the render replace the view's ruler in the gutter and the leader lines.
    initLayer1Dom();
    const rows = [
        { axisPx: 0, text: "now", eventCount: 1, axisPxList: [0], instants: [] },
        { axisPx: 22, text: "07-01 10:00:00.000", eventCount: 1, axisPxList: [22], instants: [T0] },
    ];
    await renderLayer1Stage({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never, undefined, rows);
    const ticks = [...document.querySelectorAll<HTMLElement>("#timelineRulerComponent .tick")];
    assert.deepEqual(ticks.map((tick) => tick.textContent), ["now", "07-01 10:00:00.000"]);
    assert.deepEqual(ticks.map((tick) => tick.style.getPropertyValue("--axis-px")), ["0", "22"]);
    const leaders = [...document.querySelectorAll<HTMLElement>("#leaders .leader")];
    assert.deepEqual(leaders.map((leader) => leader.style.getPropertyValue("--axis-px")), ["0", "22"]);
});

// not behavior: only spies that an internal scroll listener was registered, no visible outcome.
// test("test_a_render_installs_the_run_viewport_scroll_listener", async () => {
//     // Scenario: drawing the stage starts the run viewport watcher, which listens for scroll on #timelineContainer.
//     initLayer1Dom();
//     const timelines = document.getElementById("timelineContainer")!;
//     const listenedEvents: string[] = [];
//     const addEventListener = timelines.addEventListener.bind(timelines);
//     timelines.addEventListener = ((type: string, ...rest: unknown[]) => {
//         listenedEvents.push(type);
//         return (addEventListener as (...args: unknown[]) => void)(type, ...rest);
//     }) as never;
//     await renderLayer1Stage({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] } as never);
//     assert.ok(listenedEvents.includes("scroll"));
// });

// Task 212 (spec S12): the layered page legend sits above the scrolled timeline and names every node class.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initLayeredDom } from "./webapp-dom-test-helpers.ts";

// The element with `id`, asserting it exists.
function getById(id: string): HTMLElement {
    const element = document.getElementById(id);
    assert.ok(element, `missing #${id}`);
    return element as HTMLElement;
}

test("test_legend_sits_above_the_scrolled_timeline_area", () => {
    // Scenario (task 212, spec S12): the legend lives in the timeline area but OUTSIDE the scrolled container, preceding it — so scrolling the timeline leaves the legend in view.
    initLayeredDom();
    const legend = getById("layered-legend");
    const scroll = getById("layered-timeline-scroll");
    const timeline = getById("layered-timeline");
    assert.ok(timeline.contains(legend));
    assert.ok(timeline.contains(scroll));
    assert.ok(scroll.contains(getById("layered-canvas")));
    assert.equal(scroll.contains(legend), false);
    assert.equal(legend.nextElementSibling, scroll);
    // CSS mechanism (happy-dom loads no stylesheet, so assert the file): the scroll child is the ONLY overflow container — .layered-timeline itself no longer scrolls.
    const css = readFileSync(new URL("../webapp/layered-styles.css", import.meta.url), "utf8");
    const scrollBlock = css.split(".layered-timeline-scroll {")[1]?.split("}")[0] ?? "";
    assert.ok(scrollBlock.includes("overflow"));
    const timelineBlock = css.split(".layered-timeline {")[1]?.split("}")[0] ?? "";
    assert.equal(timelineBlock.includes("overflow"), false);
});

test("test_legend_names_every_layered_node_class", () => {
    // Scenario (task 212): the legend carries the mockup's node vocabulary (plans/mvp-app-mockup.html) so every rendered node class is decodable.
    initLayeredDom();
    const legendText = getById("layered-legend").textContent ?? "";
    for (const label of ["anchor", "commit", "snapshot", "presumed user edit", "script run",
        "full-content echo", "on-disk", "ignored"]) {
        assert.ok(legendText.includes(label), `legend is missing "${label}"`);
    }
});

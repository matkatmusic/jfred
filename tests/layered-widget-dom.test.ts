// Task 207 (spec S8): DOM builders for one layered file widget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayeredDom } from "./webapp-dom-test-helpers.ts";

const EARLY = "2026-07-25T10:00:00.000Z";
const LATE = "2026-07-25T10:05:00.000Z";

test("test_buildFileWidget_emits_axis_offsets_lanes_and_corroboration", async () => {
    // Scenario: a widget carries ruler pixels, one lane per session, and corroboration lines first.  Steps: build one widget.
    initLayeredDom();
    const { buildFileWidget } = await import("../webapp/layered-widget-dom.ts");
    const model = {
        fileName: "/w/a.py",
        lanes: [{ sessionFile: "/p/a.jsonl", timeline: { nodes: [{ kind: "beacon", instant: EARLY }, { kind: "beacon", instant: LATE }] } }],
        startInstant: new Date(EARLY),
        corroboratedInstants: [new Date(LATE)],
    };
    const widget = buildFileWidget(model, 3, new Date(EARLY), { [EARLY]: 0, [LATE]: 12.5 });
    assert.equal(widget.id, "layered-file-widget-3");
    assert.equal(widget.style.getPropertyValue("--axis-px"), "0");
    assert.equal(widget.style.getPropertyValue("--axis-span-px"), "12.5");
    assert.equal(widget.querySelector(".layered-file-name")?.textContent, "/w/a.py");
    assert.equal(widget.querySelectorAll(".layered-lane").length, 1);
    assert.equal((widget.querySelector(".layered-lane") as HTMLElement).dataset.session, "a.jsonl");
    assert.equal(widget.querySelectorAll(".layered-node").length, 2);
    assert.equal(widget.querySelector(".layered-lanes")?.firstElementChild?.className, "layered-corroboration");
});

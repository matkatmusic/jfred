// Task 259: a run of nodes in ONE bubble that share an instant must be wrapped in a single grouping marker. Task 251 stopped a commit and an on-disk mtime at the same instant from overprinting by giving each its own 22 px row — but once they are on separate rows nothing says they were simultaneous, and this marker is what restores that.
//
// buildTieGroupMarkers is called DIRECTLY rather than through a page boot: the behaviour under test is pure element construction, so a stubbed NDJSON stream would only widen the failure surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

// el() needs a document.
setupLayer1Dom();

// The fixture's README.md tie: commit 4d5e6f70 and the file's mtime land on the same instant, so task 251's axis charges that instant two stacked rows — one RULER_NODE_ROW_PIXELS (22) apart.
const TIED_INSTANT = "2026-07-20T16:00:00.000Z";
const TIED_COMMIT = { instant: TIED_INSTANT, axisPx: 100 };
const TIED_ON_DISK = { instant: TIED_INSTANT, axisPx: 122 };
const THIRD_TIED_NODE = { instant: TIED_INSTANT, axisPx: 144 };
const LATER_ON_DISK = { instant: "2026-07-21T16:00:00.000Z", axisPx: 160 };

// Every widget's nodes are drawn relative to its own anchor, which is its earliest node — here the first tied node.
const WIDGET_START_PX = 100;

function readCustomProperty(element: HTMLElement, name: string): string {
    return element.style.getPropertyValue(name);
}

test("test_two_nodes_sharing_one_instant_are_wrapped_in_one_group_marker", async () => {
    // Scenario (task 259): a commit and an on-disk mtime at one instant occupy two stacked rows; exactly one rectangle must be drawn around them.  Steps: build the markers for a two-node ladder whose instants are equal.
    const { buildTieGroupMarkers } = await import("../webapp/layer1-tie-groups.ts");
    const markers = buildTieGroupMarkers([TIED_COMMIT, TIED_ON_DISK], WIDGET_START_PX);
    // one run of tied nodes yields one marker, never one per node.
    assert.equal(markers.length, 1);
    // it carries the grouping class the stylesheet draws the rounded rectangle from.
    assert.ok(markers[0]!.classList.contains("tiegroup"));
    // it is anchored on the run's FIRST node, expressed relative to the widget's own anchor.
    assert.equal(readCustomProperty(markers[0]!, "--axis-px"), "0");
    // and it spans from that first node to the last one in the run.
    assert.equal(readCustomProperty(markers[0]!, "--span-px"), "22");
});

test("test_nodes_at_distinct_instants_get_no_group_marker", async () => {
    // Scenario (task 259): the overwhelming majority of pairs have no tie at all, and those bubbles must render exactly as they did before this task.  Steps: build the markers for a ladder whose two nodes are a day apart.
    const { buildTieGroupMarkers } = await import("../webapp/layer1-tie-groups.ts");
    const markers = buildTieGroupMarkers([TIED_COMMIT, LATER_ON_DISK], WIDGET_START_PX);
    // nothing is drawn.
    assert.deepEqual(markers, []);
});

test("test_a_run_of_three_tied_nodes_yields_one_marker_spanning_all_three", async () => {
    // Scenario (task 259): a run is grouped as a WHOLE — grouping pairwise instead would draw two overlapping rectangles over the same three rows.  Steps: build the markers for a ladder of three nodes that all share one instant.
    const { buildTieGroupMarkers } = await import("../webapp/layer1-tie-groups.ts");
    const markers = buildTieGroupMarkers([TIED_COMMIT, TIED_ON_DISK, THIRD_TIED_NODE], WIDGET_START_PX);
    // still one marker.
    assert.equal(markers.length, 1);
    // reaching the third node's row, two row pitches down.
    assert.equal(readCustomProperty(markers[0]!, "--span-px"), "44");
});

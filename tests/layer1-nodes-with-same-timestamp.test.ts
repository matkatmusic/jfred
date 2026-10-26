// Task 259: a run of nodes in ONE bubble that share an instant must be wrapped in a single grouping marker. Task 251 stopped a commit and an on-disk mtime at the same instant from overprinting by giving each its own 22 px row — but once they are on separate rows nothing says they were simultaneous, and this marker is what restores that.  buildNodesWithSameTimestampMarkers is called DIRECTLY rather than through a page boot: the behaviour under test is pure element construction, so a stubbed NDJSON stream would only widen the failure surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// createElement() needs a document.
initLayer1Dom();

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
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK], WIDGET_START_PX);
    // one run of tied nodes yields one marker, never one per node.
    assert.equal(markers.length, 1);
    // it carries the grouping class the stylesheet draws the rounded rectangle from.
    assert.ok(markers[0]!.classList.contains("nodes-with-same-timestamp"));
    // it is anchored on the run's FIRST node, expressed relative to the widget's own anchor.
    assert.equal(readCustomProperty(markers[0]!, "--axis-px"), "0");
    // and it spans from that first node to the last one in the run.
    assert.equal(readCustomProperty(markers[0]!, "--span-px"), "22");
});

test("test_nodes_at_distinct_instants_get_no_group_marker", async () => {
    // Scenario (task 259): the overwhelming majority of pairs have no tie at all, and those bubbles must render exactly as they did before this task.  Steps: build the markers for a ladder whose two nodes are a day apart.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, LATER_ON_DISK], WIDGET_START_PX);
    // nothing is drawn.
    assert.deepEqual(markers, []);
});

test("test_a_run_of_three_tied_nodes_yields_one_marker_spanning_all_three", async () => {
    // Scenario (task 259): a run is grouped as a WHOLE — grouping pairwise instead would draw two overlapping rectangles over the same three rows.  Steps: build the markers for a ladder of three nodes that all share one instant.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK, THIRD_TIED_NODE], WIDGET_START_PX);
    // still one marker.
    assert.equal(markers.length, 1);
    // reaching the third node's row, two row pitches down.
    assert.equal(readCustomProperty(markers[0]!, "--span-px"), "44");
});

test("test_tied_nodes_that_are_not_adjacent_still_get_one_marker", async () => {
    // Scenario (task 259, bug): since task 312 snapshots follow "on disk", so the last snapshot can tie with "on disk" with other nodes between them.  Steps: build the markers for a ladder where the first and last nodes share an instant.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-nodes-with-same-timestamp.ts");
    const onDisk = { instant: TIED_INSTANT, axisPx: 100 };
    const firstSnapshot = { instant: "2026-07-21T16:00:00.000Z", axisPx: 122 };
    const secondSnapshot = { instant: "2026-07-22T16:00:00.000Z", axisPx: 144 };
    const tiedSnapshot = { instant: TIED_INSTANT, axisPx: 166 };
    const markers = buildNodesWithSameTimestampMarkers([onDisk, firstSnapshot, secondSnapshot, tiedSnapshot], WIDGET_START_PX);
    // one marker for the one tie.
    assert.equal(markers.length, 1);
    assert.equal(readCustomProperty(markers[0]!, "--axis-px"), "0");
    // spanning from the earliest tied node to the latest.
    assert.equal(readCustomProperty(markers[0]!, "--span-px"), "66");
});

test("test_a_trunk_node_and_a_lane_node_at_one_instant_give_one_marker_that_spans_one_lane", async () => {
    // Task 357: S25 lets a tie group cross lanes; the marker records how many lanes it reaches into.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, { ...TIED_ON_DISK, laneIndex: 1 }], WIDGET_START_PX);
    assert.equal(markers.length, 1);
    assert.equal(readCustomProperty(markers[0]!, "--lanes-spanned"), "1");
});

test("test_a_tie_on_the_trunk_alone_sets_no_lanes_spanned", async () => {
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK], WIDGET_START_PX);
    assert.equal(readCustomProperty(markers[0]!, "--lanes-spanned"), "");
});

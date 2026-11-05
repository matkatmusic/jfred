// Task 259: same-instant nodes in one bubble share one grouping marker; tested without a page boot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

// createElement() needs a document.
initLayer1Dom();

// README.md tie: commit 4d5e6f70 and the mtime share an instant, so they sit 22 px apart.
const TIED_INSTANT = "2026-07-20T16:00:00.000Z";
const TIED_COMMIT = { instant: TIED_INSTANT, axisPx: 100 };
const TIED_ON_DISK = { instant: TIED_INSTANT, axisPx: 122 };
const THIRD_TIED_NODE = { instant: TIED_INSTANT, axisPx: 144 };
const LATER_ON_DISK = { instant: "2026-07-21T16:00:00.000Z", axisPx: 160 };

// A widget draws its nodes relative to its earliest node, here the first tied node.
const WIDGET_START_PX = 100;

function readCustomProperty(element: HTMLElement, name: string): string {
    return element.style.getPropertyValue(name);
}

test("test_two_nodes_sharing_one_instant_are_wrapped_in_one_group_marker", async () => {
    // Task 259: a commit and an on-disk mtime at one instant get exactly one rectangle.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
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
    // Task 259: two nodes a day apart draw no marker, so untied bubbles render as before.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, LATER_ON_DISK], WIDGET_START_PX);
    // nothing is drawn.
    assert.deepEqual(markers, []);
});

test("test_a_run_of_three_tied_nodes_yields_one_marker_spanning_all_three", async () => {
    // Task 259: three nodes at one instant get one rectangle, not two overlapping pairwise ones.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK, THIRD_TIED_NODE], WIDGET_START_PX);
    // still one marker.
    assert.equal(markers.length, 1);
    // reaching the third node's row, two row pitches down.
    assert.equal(readCustomProperty(markers[0]!, "--span-px"), "44");
});

test("test_tied_nodes_that_are_not_adjacent_still_get_one_marker", async () => {
    // Task 259: the first and last nodes of a ladder can tie with other nodes between them.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
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
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, { ...TIED_ON_DISK, laneIndex: 1 }], WIDGET_START_PX);
    assert.equal(markers.length, 1);
    assert.equal(readCustomProperty(markers[0]!, "--lanes-spanned"), "1");
});

test("test_a_tie_of_one_trunk_node_and_a_lane_node_gets_the_branch_tie_class", async () => {
    // Bug 480: with branch off only the lane node makes this tie, so the stylesheet must hide it.
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, { ...TIED_ON_DISK, laneIndex: 1 }], WIDGET_START_PX);
    assert.ok(markers[0]!.classList.contains("branch-tie"));
});

test("test_a_tie_of_two_trunk_nodes_and_a_lane_node_does_not_get_the_branch_tie_class", async () => {
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK, { ...THIRD_TIED_NODE, laneIndex: 1 }], WIDGET_START_PX);
    assert.equal(markers[0]!.classList.contains("branch-tie"), false);
});

test("test_a_tie_on_the_trunk_alone_does_not_get_the_branch_tie_class", async () => {
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK], WIDGET_START_PX);
    assert.equal(markers[0]!.classList.contains("branch-tie"), false);
});

test("test_a_tie_on_the_trunk_alone_sets_no_lanes_spanned", async () => {
    const { buildNodesWithSameTimestampMarkers } = await import("../webapp/layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts");
    const markers = buildNodesWithSameTimestampMarkers([TIED_COMMIT, TIED_ON_DISK], WIDGET_START_PX);
    assert.equal(readCustomProperty(markers[0]!, "--lanes-spanned"), "");
});

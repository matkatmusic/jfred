// Tests for minimap-position-checks: the minimap edge judge and the minimap pinned judge, with canned facts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isMinimapPinnedAfterScroll, isMinimapTouchingRightmostEdge, type MinimapEdgeFacts, type MinimapPinFacts, type MinimapRect } from "../scripts/visual/minimap-position-checks.ts";

// The ruler ends at 384 and the commits drawer ends at 700: the minimap must start at 700.
const EDGE_BOTH: MinimapEdgeFacts = { minimapLeft: 700, rulerRight: 384, drawerRight: 700 };
const HOME_RECT: MinimapRect = { left: 700, top: 120, width: 180, height: 400 };
const PINNED: MinimapPinFacts = { rectBefore: HOME_RECT, rectAfterScrollForward: HOME_RECT, rectAfterScrollBackward: HOME_RECT, borderRadius: "8px" };

test("test_minimap_edge_check_passes_when_left_touches_the_rightmost_edge", () => {
    // Both edges present: the minimap left equals the larger right edge.
    assert.equal(isMinimapTouchingRightmostEdge(EDGE_BOTH), true);
});

test("test_minimap_edge_check_passes_within_one_pixel", () => {
    // The minimap left is 0.8 px off the rightmost edge.
    assert.equal(isMinimapTouchingRightmostEdge({ ...EDGE_BOTH, minimapLeft: 700.8 }), true);
});

test("test_minimap_edge_check_passes_when_the_drawer_is_absent", () => {
    // Only the ruler is present: the minimap left equals the ruler right edge.
    assert.equal(isMinimapTouchingRightmostEdge({ minimapLeft: 384, rulerRight: 384, drawerRight: null }), true);
});

test("test_minimap_edge_check_passes_when_the_ruler_is_absent", () => {
    // Only the drawer is present: the minimap left equals the drawer right edge.
    assert.equal(isMinimapTouchingRightmostEdge({ minimapLeft: 700, rulerRight: null, drawerRight: 700 }), true);
});

test("test_minimap_edge_check_fails_when_left_is_5px_off", () => {
    // The minimap left is 5 px right of the rightmost edge.
    assert.equal(isMinimapTouchingRightmostEdge({ ...EDGE_BOTH, minimapLeft: 705 }), false);
    // The minimap left is 5 px left of the rightmost edge.
    assert.equal(isMinimapTouchingRightmostEdge({ ...EDGE_BOTH, minimapLeft: 695 }), false);
});

test("test_minimap_edge_check_fails_when_left_only_touches_the_smaller_edge", () => {
    // The minimap starts at the ruler right edge, but the drawer ends further right.
    assert.equal(isMinimapTouchingRightmostEdge({ ...EDGE_BOTH, minimapLeft: 384 }), false);
});

test("test_minimap_edge_check_fails_when_no_edge_is_present", () => {
    // Neither the ruler nor the drawer exists: there is nothing to touch.
    assert.equal(isMinimapTouchingRightmostEdge({ minimapLeft: 0, rulerRight: null, drawerRight: null }), false);
});

test("test_minimap_pinned_check_passes_when_the_rect_is_unchanged_and_corners_are_round", () => {
    // Both scrolls leave the rect equal to the home rect, and the border radius is 8px.
    assert.equal(isMinimapPinnedAfterScroll(PINNED), true);
});

test("test_minimap_pinned_check_passes_within_half_a_pixel", () => {
    // The rect drifts 0.4 px on every side after the scrolls.
    const drifted: MinimapRect = { left: 700.4, top: 120.4, width: 180.4, height: 400.4 };
    assert.equal(isMinimapPinnedAfterScroll({ ...PINNED, rectAfterScrollForward: drifted, rectAfterScrollBackward: drifted }), true);
});

test("test_minimap_pinned_check_fails_when_the_minimap_moved_after_scrolling_forward", () => {
    // After scrolling forward 600 px the minimap top is 600 px higher.
    assert.equal(isMinimapPinnedAfterScroll({ ...PINNED, rectAfterScrollForward: { ...HOME_RECT, top: -480 } }), false);
});

test("test_minimap_pinned_check_fails_when_the_minimap_moved_after_scrolling_backward", () => {
    // After scrolling backward 600 px the minimap left is 600 px further left.
    assert.equal(isMinimapPinnedAfterScroll({ ...PINNED, rectAfterScrollBackward: { ...HOME_RECT, left: 100 } }), false);
});

test("test_minimap_pinned_check_fails_when_the_size_changed_after_scrolling", () => {
    // After scrolling the minimap height shrinks by 1 px.
    assert.equal(isMinimapPinnedAfterScroll({ ...PINNED, rectAfterScrollForward: { ...HOME_RECT, height: 399 } }), false);
});

test("test_minimap_pinned_check_fails_when_the_border_radius_is_0px", () => {
    // The rect is unchanged, but the computed border radius is "0px".
    assert.equal(isMinimapPinnedAfterScroll({ ...PINNED, borderRadius: "0px" }), false);
});

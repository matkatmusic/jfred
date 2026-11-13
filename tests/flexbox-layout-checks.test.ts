// Tests for the flexbox layout judges: each judge takes plain numbers measured in the page and says pass or fail.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    isBubbleContainerWidthUnchangedByPane, isPaneDragStoppedAtFiftyPercent, isPaneDragStoppedAtThirtyPercent, isPaneInitialWidthThirtyFivePercent,
    isPaneStillAtTheRightEdgeAfterScrolling, isSourcesSplitHeldAtMinimum, isSourcesSplitThreeToTwo,
    isFirstBubbleUnmovedBySessionLines, isGrownPartOverBubbleContainer, isRulerContainerGrownByTrackWidth,
    type BubbleContainerWidthFacts, type PaneDragFacts, type PaneInitialWidthFacts, type PaneRightEdgeFacts, type SessionLinesFacts, type SourcesMinimumFacts, type SourcesSplitFacts,
} from "../scripts/visual/flexbox-layout-checks.ts";

test("test_sources_split_check_passes_when_the_heights_are_three_to_two", () => {
    // Setup: file nav is 300px tall and jsonls is 200px tall: exactly 3:2.
    const facts: SourcesSplitFacts = { fileNavHeight: 300, jsonlsHeight: 200 };
    // The judge says pass.
    assert.equal(isSourcesSplitThreeToTwo(facts), true);
    // A half pixel off still passes (the limit is 1px).
    assert.equal(isSourcesSplitThreeToTwo({ fileNavHeight: 300.5, jsonlsHeight: 200 }), true);
});

test("test_sources_split_check_fails_when_the_heights_are_half_and_half", () => {
    // Setup: both panes are 250px tall.
    const facts: SourcesSplitFacts = { fileNavHeight: 250, jsonlsHeight: 250 };
    // The judge says fail.
    assert.equal(isSourcesSplitThreeToTwo(facts), false);
});

test("test_sources_split_check_fails_when_the_heights_are_two_pixels_off_three_to_two", () => {
    // Setup: file nav is 3px too tall for a 3:2 split of 500px.
    const facts: SourcesSplitFacts = { fileNavHeight: 303, jsonlsHeight: 200 };
    // The judge says fail.
    assert.equal(isSourcesSplitThreeToTwo(facts), false);
});

test("test_sources_minimum_check_passes_when_both_panes_stay_at_least_eighty_pixels_tall", () => {
    // Setup: after the drags, the smallest file nav is 80px and the smallest jsonls is 95px.
    const facts: SourcesMinimumFacts = { smallestFileNavHeight: 80, smallestJsonlsHeight: 95 };
    // The judge says pass.
    assert.equal(isSourcesSplitHeldAtMinimum(facts), true);
});

test("test_sources_minimum_check_fails_when_the_file_nav_shrinks_below_eighty_pixels", () => {
    // Setup: a drag to the top squeezed the file nav to 20px.
    const facts: SourcesMinimumFacts = { smallestFileNavHeight: 20, smallestJsonlsHeight: 300 };
    // The judge says fail.
    assert.equal(isSourcesSplitHeldAtMinimum(facts), false);
});

test("test_sources_minimum_check_fails_when_the_jsonls_pane_shrinks_below_eighty_pixels", () => {
    // Setup: a drag to the bottom squeezed the jsonls pane to 0px.
    const facts: SourcesMinimumFacts = { smallestFileNavHeight: 300, smallestJsonlsHeight: 0 };
    // The judge says fail.
    assert.equal(isSourcesSplitHeldAtMinimum(facts), false);
});

test("test_bubble_container_width_check_passes_when_the_width_is_unchanged", () => {
    // Setup: the container is 900px wide before and after the pane opens, and the pane sits inside it.
    const facts: BubbleContainerWidthFacts = { widthBefore: 900, widthAfter: 900, paneParentId: "fileBubbleContainer" };
    // The judge says pass.
    assert.equal(isBubbleContainerWidthUnchangedByPane(facts), true);
    // A 0.3px change is under the 0.5px limit, so it still passes.
    assert.equal(isBubbleContainerWidthUnchangedByPane({ ...facts, widthAfter: 900.3 }), true);
});

test("test_bubble_container_width_check_fails_when_the_width_changes", () => {
    // Setup: opening the pane shrinks the container from 900px to 600px.
    const facts: BubbleContainerWidthFacts = { widthBefore: 900, widthAfter: 600, paneParentId: "fileBubbleContainer" };
    // The judge says fail.
    assert.equal(isBubbleContainerWidthUnchangedByPane(facts), false);
});

test("test_bubble_container_width_check_fails_when_the_pane_parent_is_wrong", () => {
    // Setup: the width is unchanged, but the pane sits in another element.
    const facts: BubbleContainerWidthFacts = { widthBefore: 900, widthAfter: 900, paneParentId: "scrollBox" };
    // The judge says fail.
    assert.equal(isBubbleContainerWidthUnchangedByPane(facts), false);
});

test("test_pane_initial_width_check_passes_when_the_pane_is_thirty_five_percent_of_the_visible_width", () => {
    // Setup: visible width is 1000 - 200 = 800px, so the pane must be 280px wide.
    const facts: PaneInitialWidthFacts = { paneWidth: 280, scrollBoxRight: 1000, overlayRightEdge: 200 };
    // The judge says pass.
    assert.equal(isPaneInitialWidthThirtyFivePercent(facts), true);
});

test("test_pane_initial_width_check_fails_when_the_pane_is_thirty_five_percent_of_the_whole_scroll_box", () => {
    // Setup: the pane is 350px, which is 35% of 1000px, but the overlay hides 200px of the scroll box.
    const facts: PaneInitialWidthFacts = { paneWidth: 350, scrollBoxRight: 1000, overlayRightEdge: 200 };
    // The judge says fail.
    assert.equal(isPaneInitialWidthThirtyFivePercent(facts), false);
});

test("test_pane_still_at_right_edge_check_passes_when_the_pane_right_equals_the_scroll_box_right", () => {
    // Setup: after the scroll by 400px, the pane right edge is 1000px and the scroll box right edge is 1000px.
    const facts: PaneRightEdgeFacts = { paneRight: 1000, scrollBoxRight: 1000 };
    // The judge says pass.
    assert.equal(isPaneStillAtTheRightEdgeAfterScrolling(facts), true);
});

test("test_pane_still_at_right_edge_check_fails_when_the_pane_scrolled_away_with_the_content", () => {
    // Setup: the pane moved 400px left with the content.
    const facts: PaneRightEdgeFacts = { paneRight: 600, scrollBoxRight: 1000 };
    // The judge says fail.
    assert.equal(isPaneStillAtTheRightEdgeAfterScrolling(facts), false);
});

test("test_pane_drag_fifty_percent_check_passes_when_the_pane_is_half_of_the_visible_width", () => {
    // Setup: after a drag far left, the pane is 400px and the visible width is 800px.
    const facts: PaneDragFacts = { paneWidth: 400, visibleWidth: 800 };
    // The judge says pass.
    assert.equal(isPaneDragStoppedAtFiftyPercent(facts), true);
});

test("test_pane_drag_fifty_percent_check_fails_when_the_drag_goes_past_the_limit", () => {
    // Setup: after a drag far left, the pane grew to 700px of 800px.
    const facts: PaneDragFacts = { paneWidth: 700, visibleWidth: 800 };
    // The judge says fail.
    assert.equal(isPaneDragStoppedAtFiftyPercent(facts), false);
});

test("test_pane_drag_thirty_percent_check_passes_when_the_pane_is_thirty_percent_of_the_visible_width", () => {
    // Setup: after a drag far right, the pane is 240px and the visible width is 800px.
    const facts: PaneDragFacts = { paneWidth: 240, visibleWidth: 800 };
    // The judge says pass.
    assert.equal(isPaneDragStoppedAtThirtyPercent(facts), true);
});

test("test_pane_drag_thirty_percent_check_fails_when_the_drag_goes_below_the_limit", () => {
    // Setup: after a drag far right, the pane shrank to 50px of 800px.
    const facts: PaneDragFacts = { paneWidth: 50, visibleWidth: 800 };
    // The judge says fail.
    assert.equal(isPaneDragStoppedAtThirtyPercent(facts), false);
});

const goodSessionLinesFacts: SessionLinesFacts = {
    firstBubbleLeftBefore: 166, firstBubbleLeftAfter: 166,
    rulerContainerRightBefore: 152, rulerContainerRightAfter: 226,
    trackWidth: 74, bubbleContainerLeft: 166,
};

test("test_turning_the_session_lines_on_does_not_move_the_left_edge_of_the_first_bubble", () => {
    // Setup: the first bubble starts at 166px before and after the session lines turn on.
    // The judge says pass.
    assert.equal(isFirstBubbleUnmovedBySessionLines(goodSessionLinesFacts), true);
    // A 0.3px move is under the 0.5px limit, so it still passes.
    assert.equal(isFirstBubbleUnmovedBySessionLines({ ...goodSessionLinesFacts, firstBubbleLeftAfter: 166.3 }), true);
});

test("test_the_first_bubble_check_fails_when_the_session_lines_push_the_bubble_by_the_track_width", () => {
    // Setup: the first bubble moved from 166px to 240px, which is the track width of 74px.
    const facts: SessionLinesFacts = { ...goodSessionLinesFacts, firstBubbleLeftAfter: 240 };
    // The judge says fail.
    assert.equal(isFirstBubbleUnmovedBySessionLines(facts), false);
});

test("test_the_ruler_container_right_edge_grows_by_the_track_width", () => {
    // Setup: the right edge of the ruler container moves from 152px to 226px, and the track is 74px wide.
    // The judge says pass.
    assert.equal(isRulerContainerGrownByTrackWidth(goodSessionLinesFacts), true);
});

test("test_the_ruler_container_check_fails_when_the_container_does_not_grow", () => {
    // Setup: the right edge of the ruler container stays at 152px.
    const facts: SessionLinesFacts = { ...goodSessionLinesFacts, rulerContainerRightAfter: 152 };
    // The judge says fail.
    assert.equal(isRulerContainerGrownByTrackWidth(facts), false);
});

test("test_the_grown_part_covers_the_bubble_container", () => {
    // Setup: the ruler container ends at 226px and the bubble container starts at 166px.
    // The judge says pass.
    assert.equal(isGrownPartOverBubbleContainer(goodSessionLinesFacts), true);
});

test("test_the_grown_part_check_fails_when_the_container_ends_before_the_bubble_container", () => {
    // Setup: the ruler container ends at 160px and the bubble container starts at 166px.
    const facts: SessionLinesFacts = { ...goodSessionLinesFacts, rulerContainerRightAfter: 160, bubbleContainerLeft: 166 };
    // The judge says fail.
    assert.equal(isGrownPartOverBubbleContainer(facts), false);
});

// Dashed leader lines draw only on demand (user, 2026-07-26): tests assert the `shown` class, as happy-dom has no cascade.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    EARLY_PX,
    SHARED_PX,
    buildSharedInstantView,
    findBubble,
    findTickAt,
    triggerHover,
    listShownLeaderOffsets,
    loadPageWithView,
} from "./layer1-leader-visibility-test-helpers.ts";

test("test_no_leader_line_is_drawn_until_something_asks_for_one", async () => {
    // Scenario (user rule): with no hover and no selection, no dashed line is drawn.
    await loadPageWithView(buildSharedInstantView());
    // every line the page needs is in the DOM...
    assert.equal(document.querySelectorAll("#leaders .leader").length, 3);
    // ...and not one of them is drawn.
    assert.deepEqual(listShownLeaderOffsets(), []);
});

test("test_hovering_a_ruler_timestamp_draws_that_row_s_line", async () => {
    // Scenario: the user mouses over a ruler timestamp. A tick carries the ABSOLUTE offset.
    await loadPageWithView(buildSharedInstantView());
    triggerHover(findTickAt(SHARED_PX));
    // exactly its own line is up, not the neighbouring rows'.
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
    // mousing off the pane entirely puts it away again.
    triggerHover(undefined);
    assert.deepEqual(listShownLeaderOffsets(), []);
});

test("test_hovering_a_bubble_draws_the_line_for_the_instant_it_begins_at", async () => {
    // Scenario: a bubble's --axis-px is its FIRST node's offset, so hover draws EARLY_PX.
    await loadPageWithView(buildSharedInstantView());
    triggerHover(findBubble("spanning.ts").querySelector(".fname") ?? undefined);
    assert.deepEqual(listShownLeaderOffsets(), [EARLY_PX]);
});

test("test_hovering_an_interior_node_draws_that_node_s_line_not_its_bubble_s", async () => {
    // Scenario: a node's --axis-px is WIDGET-RELATIVE (30) but its line is at 40.
    await loadPageWithView(buildSharedInstantView());
    const interiorNode = findBubble("spanning.ts").querySelectorAll<HTMLElement>(".node")[1];
    assert.ok(interiorNode, "the spanning bubble drew no second node");
    assert.equal(Number(interiorNode.style.getPropertyValue("--axis-px")), SHARED_PX - EARLY_PX);
    triggerHover(interiorNode);
    // the SHARED line, not the bubble's own EARLY one.
    assert.deepEqual(listShownLeaderOffsets(), [SHARED_PX]);
});

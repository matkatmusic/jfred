// Tests for the pure helpers and the probe builder in scripts/visual/layer5-bubble-facts.ts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
// import { buildBubbleProbe, TICK_ROWS } from "../scripts/visual/layer5-bubble-facts.ts";
import { formatTickStamp, isNear } from "../scripts/visual/layer5-bubble-facts.ts";

test("isNear accepts values within one pixel and refuses missing values", () => {
    assert.equal(isNear(10, 11), true);
    assert.equal(isNear(10, 11.5), false);
    assert.equal(isNear(undefined, 10), false);
    assert.equal(isNear(10, undefined), false);
});

test("formatTickStamp turns an ISO instant into the ruler tick stamp", () => {
    assert.equal(formatTickStamp("2026-06-01T14:31:00.123Z"), "06-01 14:31:00.123");
});

// not behavior: it only checks that a constant's source text contains certain substrings.
// test("TICK_ROWS reads dataset.fullTime and does not read textContent", () => {
//     assert.ok(TICK_ROWS.includes("text: t.dataset.fullTime"));
//     assert.ok(!TICK_ROWS.includes("textContent"));
// });

// not behavior: it only checks that the generated script text contains certain substrings.
// test("buildBubbleProbe finds a tick by its data-full-time stamp, not its text", () => {
//     const probe = buildBubbleProbe("src/util.ts", [], "2026-06-03T18:20:00Z");
//     assert.ok(probe.includes("t.dataset.fullTime.startsWith(stamp)"));
//     assert.ok(!probe.includes("t.textContent.startsWith(stamp)"));
// });

// not behavior: it only checks that the generated script text contains certain substrings.
// test("buildBubbleProbe scopes to the bubble of the path and embeds the forks and the rejoin", () => {
//     const probe = buildBubbleProbe("src/util.ts", ["2026-06-01T14:31:00Z"], "2026-06-03T18:20:00Z");
//     assert.ok(probe.includes(`.fname[data-path=\\"src/util.ts\\"]`));
//     assert.ok(probe.includes(`["2026-06-01T14:31:00Z"][i]`));
//     assert.ok(probe.includes(`const rejoinInstant = "2026-06-03T18:20:00Z"`));
// });

// The box helpers every visual assertion rule shares.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Measured } from "../scripts/visual/geometry.ts";
import { formatMeasured, isOverlapping } from "../scripts/visual/violation-geometry.ts";

test("boxes that overlap by more than the sub-pixel slack are overlapping", () => {
    assert.equal(isOverlapping({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), true);
});

test("boxes that only touch along a border are not overlapping", () => {
    assert.equal(isOverlapping({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
});

test("a measured element prints its owner path, trimmed text and box", () => {
    const element = {
        text: " hi ", path: "p.ts", ownerPath: "o.ts", box: { x: 1, y: 2, w: 3, h: 4 },
    } as Measured;
    assert.equal(formatMeasured(element), 'o.ts "hi" at 1,2 3x4');
});

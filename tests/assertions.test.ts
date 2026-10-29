// Visual assertion rules on hand-built geometry: each fires on its bug and stays quiet on the fix.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
    findOffscreenLandings, findOverlaps, findTextOverflow, listStateViolations,
} from "../scripts/visual/assertions.ts";
import type { Box, Measured, StateGeometry } from "../scripts/visual/geometry.ts";

function measured(group: string, box: Box, extra: Partial<Measured> = {}): Measured {
    return {
        group, cls: group, text: "", path: null, ownerPath: null, laneIndex: 0, isBucket: false, box,
        scrollWidth: box.w, clientWidth: box.w, clientHeight: box.h, lineHeight: 12, ...extra,
    };
}

function geometry(parts: Partial<StateGeometry> = {}): StateGeometry {
    return {
        state: "test", zoom: "1", crumb: "", findStatus: "",
        viewport: { w: 1600, h: 1000 },
        scroller: { x: 0, y: 100, w: 1200, h: 800, scrollLeft: 0, scrollTop: 0 },
        fileboxes: [], fnames: [], nodes: [], labels: [], ticks: [], tickFiles: [], found: [],
        ...parts,
    };
}

test("overlapping nodes in one lane are reported, stacked rows are not", () => {
    const stacked = geometry({
        nodes: [
            measured("node", { x: 10, y: 0, w: 15, h: 15 }),
            measured("node", { x: 10, y: 22, w: 15, h: 15 }),
        ],
    });
    assert.equal(findOverlaps(stacked).length, 0);
    const collided = geometry({
        nodes: [
            measured("node", { x: 10, y: 0, w: 15, h: 15 }),
            measured("node", { x: 12, y: 4, w: 15, h: 15 }),
        ],
    });
    assert.equal(findOverlaps(collided).length, 1);
    assert.equal(findOverlaps(collided)[0]!.rule, "overlapping-nodes");
});

test("nodes at the same offset in DIFFERENT lanes are not a collision", () => {
    const view = geometry({
        nodes: [
            measured("node", { x: 10, y: 0, w: 15, h: 15 }, { laneIndex: 0 }),
            measured("node", { x: 10, y: 0, w: 15, h: 15 }, { laneIndex: 1 }),
        ],
    });
    assert.equal(findOverlaps(view).length, 0);
});

test("two bubbles drawn over each other are reported", () => {
    const view = geometry({
        fileboxes: [
            measured("filebox", { x: 0, y: 0, w: 168, h: 400 }, { ownerPath: "a.ts" }),
            measured("filebox", { x: 100, y: 50, w: 168, h: 400 }, { ownerPath: "b.ts" }),
        ],
    });
    const found = findOverlaps(view);
    assert.equal(found.length, 1);
    assert.match(found[0]!.detail, /a\.ts.*overlaps.*b\.ts/);
});

test("a wrapped commit row is reported, a single-line one is not", () => {
    const single = geometry({
        labels: [measured("nlabel", { x: 0, y: 0, w: 48, h: 12 }, { lineHeight: 12 })],
    });
    assert.equal(findTextOverflow(single).length, 0);
    const wrapped = geometry({
        labels: [measured("nlabel", { x: 0, y: 0, w: 48, h: 26 }, { lineHeight: 12, text: "0f2a91cc" })],
    });
    const found = findTextOverflow(wrapped);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.rule, "wrapped-commit-row");
});

test("a commit row that runs past its bubble onto a neighbour is reported", () => {
    const view = geometry({
        fileboxes: [
            measured("filebox", { x: 0, y: 0, w: 168, h: 400 }, { ownerPath: "a.ts" }),
            measured("filebox", { x: 194, y: 0, w: 168, h: 400 }, { ownerPath: "b.ts" }),
        ],
        labels: [measured("nlabel", { x: 32, y: 10, w: 240, h: 12 }, { ownerPath: "a.ts", text: "0f2a91cc9d" })],
    });
    const found = findTextOverflow(view);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.rule, "commit-row-overprints-neighbour");
    assert.match(found[0]!.detail, /paints over b\.ts/);
});

test("a label that overflows its bubble but hits nothing is not reported", () => {
    const view = geometry({
        fileboxes: [measured("filebox", { x: 0, y: 0, w: 168, h: 400 }, { ownerPath: "a.ts" })],
        labels: [measured("nlabel", { x: 32, y: 10, w: 200, h: 12 }, { ownerPath: "a.ts" })],
    });
    assert.equal(findTextOverflow(view).length, 0);
});

test("a landing outside the timeline pane is reported, one inside is not", () => {
    const inside = geometry({ found: [measured("found", { x: 400, y: 300, w: 168, h: 200 })] });
    assert.equal(findOffscreenLandings(inside).length, 0);
    const outside = geometry({
        found: [measured("found", { x: 400, y: 4000, w: 168, h: 200 }, { ownerPath: "far.ts" })],
    });
    const reported = findOffscreenLandings(outside);
    assert.equal(reported.length, 1);
    assert.equal(reported[0]!.rule, "landing-outside-viewport");
});

test("no jump means nothing to check", () => {
    assert.equal(findOffscreenLandings(geometry()).length, 0);
});

test("a clean state produces no violations at all", () => {
    assert.deepEqual(listStateViolations(geometry()), []);
});

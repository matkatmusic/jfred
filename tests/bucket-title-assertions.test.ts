// Rule 3 of the visual assertions: bucket headings printed where a file path belongs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { findBucketTitleLabels } from "../scripts/visual/bucket-title-assertions.ts";
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

test("a pair bubble printing a bucket heading is reported, the bucket itself is not", () => {
    const bucket = geometry({
        fnames: [measured("fname", { x: 0, y: 0, w: 100, h: 14 }, { text: "No on-disk match", isBucket: true })],
    });
    assert.equal(findBucketTitleLabels(bucket).length, 0);
    const mislabelled = geometry({
        fnames: [measured("fname", { x: 0, y: 0, w: 100, h: 14 }, { text: "No on-disk match", path: "src/a.ts" })],
    });
    assert.equal(findBucketTitleLabels(mislabelled)[0]!.rule, "bucket-title-as-file-label");
});

test("a pair bubble with no data-path is reported", () => {
    const view = geometry({
        fnames: [measured("fname", { x: 0, y: 0, w: 100, h: 14 }, { text: "a.ts", path: null })],
    });
    assert.match(findBucketTitleLabels(view)[0]!.detail, /data-path=\(missing\)/);
});

test("an expanded ruler row listing a bucket heading as a file is reported", () => {
    const view = geometry({
        tickFiles: [measured("tickfile", { x: 0, y: 0, w: 300, h: 20 }, { text: "No repository match" })],
    });
    assert.equal(findBucketTitleLabels(view)[0]!.rule, "bucket-title-in-tick-list");
});

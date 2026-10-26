// The geometry probe stays a valid template literal, and its bucket headings match the ones layer1-stage-render.ts renders.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BUCKET_TITLES, GEOMETRY_PROBE, type StateGeometry } from "../scripts/visual/geometry.ts";

const JFRED_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the probe contains no backtick and no template interpolation", () => {
    assert.equal(GEOMETRY_PROBE.includes("`"), false);
    assert.equal(GEOMETRY_PROBE.includes("${"), false);
});

test("the probe emits every field the dump declares", () => {
    const fields: (keyof StateGeometry)[] = [
        "zoom", "crumb", "findStatus", "viewport", "scroller",
        "fileboxes", "fnames", "nodes", "labels", "ticks", "tickFiles", "found",
    ];
    for (const field of fields) {
        assert.ok(GEOMETRY_PROBE.includes(`${field}:`), `probe never emits ${field}`);
    }
});

test("the bucket headings match the ones layer1-page.ts renders", () => {
    const page = readFileSync(join(JFRED_ROOT, "webapp", "layer1-stage-render.ts"), "utf8");
    for (const title of BUCKET_TITLES) {
        assert.ok(page.includes(`buildOrphanBucket("${title}"`), `layer1-stage-render.ts no longer renders ${title}`);
    }
});

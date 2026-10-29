// spawnWash builds one .wash band whose custom properties carry its start, span and color.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnWash } from "../webapp/layer1-wash.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("spawnWash sets the start, span and color custom properties", () => {
    initLayer1Dom();
    const wash = spawnWash(20, 120, "red");
    assert.equal(wash.className, "wash");
    assert.equal(wash.style.getPropertyValue("--axis-px"), "20");
    assert.equal(wash.style.getPropertyValue("--span-px"), "100");
    assert.equal(wash.style.getPropertyValue("--wash-color"), "red");
});

// layer4.ts cannot be imported (top-level await); these tests read its source for the wiring it needs.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { executeLayer4RealChecks } from "../scripts/visual/layer4-real-checks.ts";

const SOURCE = readFileSync(new URL("../scripts/visual/layer4.ts", import.meta.url), "utf8");

test("layer4.ts imports the real checks it drives from layer4-real-checks.ts", () => {
    assert.equal(typeof executeLayer4RealChecks, "function");
    assert.ok(SOURCE.includes(`import { executeLayer4RealChecks } from "./layer4-real-checks.ts";`));
});

test("layer4.ts runs the real checks with the jot screenshot name when --jot is given", () => {
    assert.ok(SOURCE.includes(`IS_JOT ? "09-layer4-jot" : "09-layer4-real"`));
});

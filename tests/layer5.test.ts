// layer5.ts has no exports and boots at module scope, so these read its source instead of importing it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const LAYER5_SOURCE = readFileSync(new URL("../scripts/visual/layer5.ts", import.meta.url), "utf8");
const BRANCHES_ROUTE_SOURCE = readFileSync(new URL("../src/viewer_server_layer1_routes.ts", import.meta.url), "utf8");

test("layer5.ts exports nothing, so importing it is not an option", () => {
    assert.equal(LAYER5_SOURCE.includes("\nexport "), false);
});

test("layer5.ts fetches an endpoint the viewer server routes", () => {
    assert.ok(LAYER5_SOURCE.includes("/api/layer1-branches"));
    assert.ok(BRANCHES_ROUTE_SOURCE.includes(`url.pathname === "/api/layer1-branches"`));
});

test("layer5.ts hands the page to the real-data checks", () => {
    assert.ok(LAYER5_SOURCE.includes(`import { executeLayer5RealChecks } from "./layer5-real-checks.ts";`));
});

// The view URL run.ts drives; importing run.ts must not start a browser.

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildViewUrl } from "../scripts/visual/run.ts";

test("the view URL carries both Layer 1 sources as query params", () => {
    const url = new URL(buildViewUrl(9999));
    assert.equal(url.port, "9999");
    assert.equal(url.pathname, "/app/layer1.html");
    assert.ok(url.searchParams.get("dir")?.endsWith("jfred"));
    assert.ok(url.searchParams.get("repo")?.endsWith("jfred"));
});


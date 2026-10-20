// The DOM helpers install a window carrying the real page markup and let queued promise chains settle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { flushAsyncWork, setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

test("setupLayer1Dom installs the layer1 page markup and seeds the URL query", () => {
    setupLayer1Dom("?progress=1");

    assert.ok(document.getElementById("stage"));
    assert.equal(location.search, "?progress=1");
});

test("flushAsyncWork lets a chain of timer-driven promises finish", async () => {
    let finished = false;
    setTimeout(() => {
        setTimeout(() => {
            finished = true;
        }, 0);
    }, 0);

    await flushAsyncWork();

    assert.equal(finished, true);
});

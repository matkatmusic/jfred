// Task 355 step 6: dispatchLayer1Route owns /api/layer1-edits in real (non-fixture) mode and ignores unknown paths.

import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { dispatchLayer1Route } from "../src/viewer_server_layer1_routes.ts";
import { createTempDir } from "./overrides-test-helpers.ts";

function dispatchGet(pathAndQuery: string): { handled: boolean; body: string } {
    let body = "";
    const append = (chunk?: string): void => {
        body += chunk ?? "";
    };
    const response = { writeHead: () => response, write: append, end: append } as unknown as ServerResponse;
    const handled = dispatchLayer1Route({ method: "GET" } as IncomingMessage, response, new URL(`http://localhost${pathAndQuery}`));
    return { handled, body };
}

test("test_dispatch_routes_layer1_edits_to_the_real_handler", () => {
    const { handled, body } = dispatchGet(`/api/layer1-edits?dir=${encodeURIComponent(createTempDir())}`);
    assert.equal(handled, true);
    assert.deepEqual(JSON.parse(body), { pairs: [] });
});

test("test_dispatch_routes_layer1_branches_to_the_real_handler", () => {
    const { handled, body } = dispatchGet(`/api/layer1-branches?dir=${encodeURIComponent(createTempDir())}`);
    assert.equal(handled, true);
    assert.deepEqual(JSON.parse(body), { pairs: [] });
});

test("test_dispatch_leaves_unknown_paths_unowned", () => {
    assert.equal(dispatchGet("/api/not-a-layer1-route").handled, false);
});

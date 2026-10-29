// Tests the two driver pieces that need no browser: the free-port probe and the poll loop.

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { findFreePort, waitUntilTruthy } from "../scripts/visual/cdp.ts";

test("findFreePort returns a port that can actually be bound", async () => {
    const port = await findFreePort();
    assert.ok(port > 0);
    await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
    });
});

test("waitUntilTruthy resolves once the expression turns truthy", async () => {
    let calls = 0;
    await waitUntilTruthy(async () => (++calls >= 3) as never, "ready", 5_000);
    assert.equal(calls, 3);
});

test("waitUntilTruthy reports the expression it gave up on", async () => {
    await assert.rejects(
        waitUntilTruthy(async () => false as never, "document.querySelector('#nope')", 400),
        /never satisfied: document.querySelector\('#nope'\)/,
    );
});

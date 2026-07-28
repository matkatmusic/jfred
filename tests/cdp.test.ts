// The driver's two pieces that do not need a browser: the free-port probe and the poll loop every state's wait is built on. Chrome itself is exercised by the loop, not by a unit test.

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { findFreePort, pollUntilTruthy } from "../scripts/visual/cdp.ts";

test("findFreePort returns a port that can actually be bound", async () => {
    const port = await findFreePort();
    assert.ok(port > 0);
    await new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
    });
});

test("pollUntilTruthy resolves once the expression turns truthy", async () => {
    let calls = 0;
    await pollUntilTruthy(async () => (++calls >= 3) as never, "ready", 5_000);
    assert.equal(calls, 3);
});

test("pollUntilTruthy reports the expression it gave up on", async () => {
    await assert.rejects(
        pollUntilTruthy(async () => false as never, "document.querySelector('#nope')", 400),
        /never satisfied: document.querySelector\('#nope'\)/,
    );
});

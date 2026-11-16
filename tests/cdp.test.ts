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

test("waitUntilTruthy adds the text of the page's #crumb to the error it gives up with", async () => {
    // Scenario: the page never draws a bubble and has written its load error into #crumb.
    // Steps: an evaluate that answers false to the wait expression and a message to the #crumb read; wait 400 ms.
    const evaluate = async (expression: string): Promise<never> => {
        const isCrumbRead = expression.includes("crumb");
        if (isCrumbRead) {
            return "Error: not a git repository" as never;
        }
        return false as never;
    };
    // Expect: the error still names the expression, and now also carries the crumb text.
    await assert.rejects(
        waitUntilTruthy(evaluate, "document.querySelector('#nope')", 400),
        /never satisfied: document.querySelector\('#nope'\).*Error: not a git repository/,
    );
});

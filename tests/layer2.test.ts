// scripts/visual/layer2.ts runs the whole browser flow at import (top-level await, no exports), so it cannot be imported here. These cover the pure payload helpers it feeds on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { collectOwnerBasenames, countExpectedSnapshots, type ViewPayload } from "../scripts/visual/layer2-payload.ts";

function snapshot(version: number, sessionFile: string) {
    return { version, sessionId: "s", sessionFile };
}

const payload: ViewPayload = {
    pairs: [
        { path: "a.ts", snapshots: [snapshot(1, "/x/one.jsonl"), snapshot(2, "/x/two.jsonl")] },
        { path: "b.ts" },
        { path: "c.ts", snapshots: [snapshot(1, "/y/one.jsonl")] },
    ],
    diskOrphans: [{ snapshots: [snapshot(1, "/z/three.jsonl")] }, {}],
};

test("countExpectedSnapshots adds pair and orphan snapshots and skips missing lists", () => {
    assert.equal(countExpectedSnapshots(payload), 4);
    assert.equal(countExpectedSnapshots({ pairs: [], diskOrphans: [] }), 0);
});

test("collectOwnerBasenames keeps unique file names from pair snapshots only", () => {
    assert.deepEqual([...collectOwnerBasenames(payload)].sort(), ["one.jsonl", "two.jsonl"]);
});

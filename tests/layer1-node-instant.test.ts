// readNodeInstant: which wire instant a lane node stands for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readNodeInstant } from "../webapp/layer1-node-instant.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";

const VIEW: WireLayer1View = {
    pairs: [{
        path: "a.ts",
        commits: [{ hash: "abc123", instant: T1, axisPx: 0 }],
        onDisk: { instant: T4, axisPx: 0 },
        snapshots: [{ version: 2, sessionId: "s1", sessionFile: "f.jsonl", instant: T3, axisPx: 0 }],
    }],
    gitOrphans: [],
    diskOrphans: [{ path: "b.ts", instant: T2, axisPx: 0 }],
    ruler: [],
};

function createNode(className: string): HTMLElement {
    initLayer1Dom();
    const node = document.createElement("i");
    node.className = className;
    return node;
}

test("readNodeInstant returns an edit node's own instant, not the on-disk one", () => {
    const node = createNode("node n-edit");
    node.dataset.instant = T2;
    assert.equal(readNodeInstant(VIEW, "a.ts", node), T2);
});

test("readNodeInstant finds a commit node by its hash", () => {
    const node = createNode("node n-commit");
    node.title = "abc123";
    assert.equal(readNodeInstant(VIEW, "a.ts", node), T1);
});

test("readNodeInstant finds a snapshot node by version and session", () => {
    const node = createNode("node n-snap");
    node.dataset.version = "2";
    node.dataset.sessionId = "s1";
    assert.equal(readNodeInstant(VIEW, "a.ts", node), T3);
});

test("readNodeInstant returns undefined for a snapshot of another session", () => {
    const node = createNode("node n-snap");
    node.dataset.version = "2";
    node.dataset.sessionId = "other";
    assert.equal(readNodeInstant(VIEW, "a.ts", node), undefined);
});

test("readNodeInstant falls back to the on-disk instant", () => {
    assert.equal(readNodeInstant(VIEW, "a.ts", createNode("node")), T4);
});

test("readNodeInstant uses the disk orphan when the path has no pair", () => {
    assert.equal(readNodeInstant(VIEW, "b.ts", createNode("node")), T2);
});

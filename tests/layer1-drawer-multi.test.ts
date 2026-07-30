// Task 329: the DiffView step ladder — markers, order, and a string-loading source per revision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listDiffableSteps } from "../webapp/layer1-drawer-multi.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";

const VIEW: WireLayer1View = {
    pairs: [{
        path: "src/a.ts",
        commits: [{ hash: "aaaaaaaabbbbbbbb", instant: T0, axisPx: 0 }, { hash: "ccccccccdddddddd", instant: T1, axisPx: 22 }],
        onDisk: { instant: T2, axisPx: 44 },
        snapshots: [{ version: 1, sessionId: "s", sessionFile: "s.jsonl", instant: T1, axisPx: 22 }],
    }],
    gitOrphans: [{ path: "src/gone.ts", instant: T1, axisPx: 22 }],
    diskOrphans: [{ path: "notes.txt", instant: T0, axisPx: 0 }],
    ruler: [],
};

test("a pair's steps are chronological: commits, its snapshot, then on disk", () => {
    const steps = listDiffableSteps(VIEW, "src/a.ts");
    assert.deepEqual(steps.map((step) => step.marker), ["aaaaaaaa", "cccccccc", "@v1 📸", "on disk"]);
});

test("every step can load its state as a string", () => {
    for (const step of listDiffableSteps(VIEW, "src/a.ts")) {
        assert.equal(typeof step.loadContent, "function", step.marker);
    }
});

test("a disk orphan has exactly one on-disk step", () => {
    assert.deepEqual(listDiffableSteps(VIEW, "notes.txt").map((step) => step.marker), ["on disk"]);
});

test("a git orphan (deleted file) has no diffable steps", () => {
    assert.deepEqual(listDiffableSteps(VIEW, "src/gone.ts"), []);
});

test("an unknown path has no diffable steps", () => {
    assert.deepEqual(listDiffableSteps(VIEW, "src/never-heard-of-it.ts"), []);
});

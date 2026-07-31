// Task 329: the DiffView step ladder — markers, order, and a string-loading source per revision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listDiffableSteps, resolveWashFileList } from "../webapp/layer1-drawer-multi.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";

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

// Task 336: three pairs plus a disk orphan and a git orphan, to prove the sweep's inclusion rule.
const SWEEP_VIEW: WireLayer1View = {
    pairs: [
        { path: "src/clicked-a.ts", commits: [], onDisk: { instant: T0, axisPx: 0 } },
        { path: "src/clicked-b.ts", commits: [], onDisk: { instant: T2, axisPx: 20 } },
        { path: "src/swept.ts", commits: [], onDisk: { instant: T1, axisPx: 10 } },
        { path: "src/excluded.ts", commits: [], onDisk: { instant: T3, axisPx: 30 } },
    ],
    gitOrphans: [{ path: "src/gone.ts", instant: T1, axisPx: 10 }],
    diskOrphans: [{ path: "notes-swept.txt", instant: T0, axisPx: 0 }],
    ruler: [],
};

test("resolveWashFileList sweeps in a pair whose step lands inside the range", () => {
    const files = resolveWashFileList(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, ["src/clicked-a.ts", "src/clicked-b.ts"]);
    assert.ok(files.includes("src/swept.ts"));
});

test("resolveWashFileList excludes a pair whose step falls outside the range", () => {
    const files = resolveWashFileList(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, ["src/clicked-a.ts", "src/clicked-b.ts"]);
    assert.equal(files.includes("src/excluded.ts"), false);
});

test("resolveWashFileList sweeps in a disk orphan whose step lands inside the range", () => {
    const files = resolveWashFileList(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, []);
    assert.ok(files.includes("notes-swept.txt"));
});

test("resolveWashFileList never sweeps in a git orphan (no diffable steps)", () => {
    // src/gone.ts's own instant (T1) sits inside T0..T2, but it has no ladder to test — must stay excluded.
    const files = resolveWashFileList(SWEEP_VIEW, { baseInstant: T0, targetInstant: T2 }, []);
    assert.equal(files.includes("src/gone.ts"), false);
});

test("resolveWashFileList always includes the caller's alwaysInclude paths, deduped and sorted", () => {
    // A day past every fixture instant: nothing touches it, isolating alwaysInclude's dedupe and sort.
    const noTouchRange = { baseInstant: "2026-07-02T00:00:00.000Z", targetInstant: "2026-07-02T00:00:00.000Z" };
    const files = resolveWashFileList(SWEEP_VIEW, noTouchRange, ["src/clicked-b.ts", "src/clicked-a.ts", "src/clicked-a.ts"]);
    assert.deepEqual(files, ["src/clicked-a.ts", "src/clicked-b.ts"]);
});

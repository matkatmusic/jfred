// Task 329: the DiffView step ladder — markers, order, and a string-loading source per revision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bracketRunInstant, buildScriptRunDiffPanes, listDiffableSteps, pathsForScriptRun, resolveWashFileList } from "../webapp/layer1-drawer-multi.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";

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

test("bracketRunInstant brackets between the nearest before and after steps", () => {
    // VIEW's src/a.ts ladder: T0 (commit), T1 (commit+snapshot), T2 (on disk).
    const bracket = bracketRunInstant(VIEW, "src/a.ts", "2026-07-01T10:30:00.000Z"); // between T0 and T1
    assert.deepEqual(bracket, { baseIndex: 0, targetIndex: 1 });
});

test("bracketRunInstant clamps to the first step when the run precedes every step", () => {
    const bracket = bracketRunInstant(VIEW, "src/a.ts", "2026-06-01T00:00:00.000Z");
    assert.deepEqual(bracket, { baseIndex: 0, targetIndex: 0 });
});

test("bracketRunInstant clamps to the last step when the run is after every step", () => {
    const bracket = bracketRunInstant(VIEW, "src/a.ts", "2026-08-01T00:00:00.000Z");
    const lastIndex = listDiffableSteps(VIEW, "src/a.ts").length - 1;
    assert.deepEqual(bracket, { baseIndex: lastIndex, targetIndex: lastIndex });
});

test("bracketRunInstant returns undefined for a path with no diffable steps", () => {
    assert.equal(bracketRunInstant(VIEW, "src/never-heard-of-it.ts", T0), undefined);
});

test("pathsForScriptRun finds every pair carrying this run's toolUseId, in path order", () => {
    const view: WireLayer1View = {
        pairs: [
            { path: "src/a.ts", commits: [], onDisk: { instant: T0, axisPx: 0 },
              scriptRuns: [{ instant: T0, axisPx: 0, toolUseId: "toolu_1", executorKind: "python", code: "x", label: "a.ts" }] },
            { path: "src/b.ts", commits: [], onDisk: { instant: T0, axisPx: 0 },
              scriptRuns: [{ instant: T0, axisPx: 0, toolUseId: "toolu_1", executorKind: "python", code: "x", label: "b.ts" }] },
            { path: "src/c.ts", commits: [], onDisk: { instant: T0, axisPx: 0 } },
        ],
        gitOrphans: [], diskOrphans: [], ruler: [],
    };
    assert.deepEqual(pathsForScriptRun(view, "toolu_1"), ["src/a.ts", "src/b.ts"]);
});

test("buildScriptRunDiffPanes renders one pane per affected path, bracketed on the run instant", async () => {
    setupLayer1Dom();
    Object.assign(globalThis, { requestAnimationFrame: (callback: FrameRequestCallback) => { callback(0); return 0; } });
    Object.assign(globalThis, {
        fetch: async (url: unknown): Promise<Response> => {
            const payload = String(url).includes("layer1-diff-content") ? { diff: "" } : { content: "x" };
            return { ok: true, status: 200, json: async () => payload, text: async () => "" } as unknown as Response;
        },
    });
    const affectedPaths = ["src/a.ts"];
    const panes = buildScriptRunDiffPanes(VIEW, "2026-07-01T10:30:00.000Z", affectedPaths);
    assert.equal(panes.length, affectedPaths.length);
    // showPair resolves its content over two drained turns (tests/layer1-drawer.test.ts precedent).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The bracket lands on the two commit steps either side of the run instant.
    assert.equal(panes[0]!.querySelector(".dpair")?.textContent, "aaaaaaaa - cccccccc");
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

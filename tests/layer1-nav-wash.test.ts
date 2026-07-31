// Task 333: File Nav selection's own oldest→newest wash over the selected files' drawn ladders.

import { test } from "node:test";
import assert from "node:assert/strict";
import { clearNavWash, renderNavWash, resolveNavWashInstants } from "../webapp/layer1-nav-wash.ts";
import { setupLayer1Dom } from "./webapp-dom-test-helpers.ts";
import type { WireLayer1View, WireRulerTick } from "../webapp/layer1-wire.ts";

const T0 = "2026-07-01T10:00:00.000Z";
const T1 = "2026-07-01T11:00:00.000Z";
const T2 = "2026-07-01T12:00:00.000Z";
const T3 = "2026-07-01T13:00:00.000Z";
const T4 = "2026-07-01T14:00:00.000Z";
const T5 = "2026-07-01T15:00:00.000Z";

function buildView(overrides: Partial<WireLayer1View> = {}): WireLayer1View {
    return { pairs: [], gitOrphans: [], diskOrphans: [], ruler: [], ...overrides };
}

test("resolveNavWashInstants spans a single pair's whole ladder", () => {
    const view = buildView({
        pairs: [{
            path: "a.ts",
            created: { instant: T0, axisPx: 0 },
            commits: [{ instant: T1, axisPx: 0, hash: "h1" }, { instant: T2, axisPx: 0, hash: "h2" }],
            onDisk: { instant: T3, axisPx: 0 },
            snapshots: [{ instant: T4, axisPx: 0, version: 1, sessionId: "s1", sessionFile: "s1.jsonl" }],
        }],
    });
    assert.deepEqual(resolveNavWashInstants(view, ["a.ts"]), { oldest: T0, newest: T4 });
});

test("resolveNavWashInstants unions across two non-overlapping selected files", () => {
    const view = buildView({
        pairs: [
            { path: "a.ts", commits: [], onDisk: { instant: T1, axisPx: 0 } },
            { path: "b.ts", commits: [], onDisk: { instant: T4, axisPx: 0 } },
        ],
    });
    assert.deepEqual(resolveNavWashInstants(view, ["a.ts", "b.ts"]), { oldest: T1, newest: T4 });
});

test("resolveNavWashInstants includes a selected disk orphan's own instant and snapshots", () => {
    const view = buildView({
        diskOrphans: [{
            path: "c.ts",
            instant: T2,
            axisPx: 0,
            snapshots: [{ instant: T5, axisPx: 0, version: 2, sessionId: "s1", sessionFile: "s1.jsonl" }],
        }],
    });
    assert.deepEqual(resolveNavWashInstants(view, ["c.ts"]), { oldest: T2, newest: T5 });
});

test("resolveNavWashInstants ignores a target that only names a gitOrphan", () => {
    const view = buildView({
        gitOrphans: [{ path: "d.ts", instant: T2, axisPx: 0 }],
    });
    assert.equal(resolveNavWashInstants(view, ["d.ts"]), undefined);
});

test("resolveNavWashInstants with no targets is undefined", () => {
    const view = buildView({
        pairs: [{ path: "a.ts", commits: [], onDisk: { instant: T1, axisPx: 0 } }],
    });
    assert.equal(resolveNavWashInstants(view, []), undefined);
});

const TICKS: WireRulerTick[] = [
    { instant: T1, axisPx: 20, eventCount: 1 },
    { instant: T4, axisPx: 120, eventCount: 1 },
];

function buildDomView(): WireLayer1View {
    return buildView({
        pairs: [{ path: "a.ts", commits: [], onDisk: { instant: T1, axisPx: 20 }, snapshots: [{ instant: T4, axisPx: 120, version: 1, sessionId: "s1", sessionFile: "s1.jsonl" }] }],
        ruler: TICKS,
    });
}

test("renderNavWash paints one .nav-wash spanning the selected pair's ladder", () => {
    setupLayer1Dom();
    renderNavWash(buildDomView(), ["a.ts"]);
    const washes = document.querySelectorAll("#washes .nav-wash");
    assert.equal(washes.length, 1);
    const wash = washes[0] as HTMLElement;
    // Half a row (11px) padded outside each edge: 20-11=9, 120+11=131, span 122.
    assert.equal(wash.style.getPropertyValue("--axis-px"), "9");
    assert.equal(wash.style.getPropertyValue("--span-px"), "122");
});

test("renderNavWash with no selection removes the wash", () => {
    setupLayer1Dom();
    renderNavWash(buildDomView(), ["a.ts"]);
    renderNavWash(buildDomView(), []);
    assert.equal(document.querySelectorAll("#washes .nav-wash").length, 0);
});

test("clearNavWash never touches a sibling wash kind", () => {
    setupLayer1Dom();
    const stray = document.createElement("div");
    stray.className = "range-wash";
    document.getElementById("washes")!.append(stray);
    renderNavWash(buildDomView(), ["a.ts"]);
    assert.equal(document.querySelectorAll("#washes .range-wash").length, 1);
});

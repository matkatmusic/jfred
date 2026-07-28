// The orchestrator's pure parts: the view URL it drives, and the two report writers that decide how much of a failing run reaches the reader. Importing this module must NOT start a browser — the entrypoint guard in run.ts is what this file silently proves.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Violation } from "../scripts/visual/assertions.ts";
import { buildViewUrl, listExamples, summarize } from "../scripts/visual/run.ts";

function violation(state: string, rule: string, detail: string): Violation {
    return { state, rule, detail };
}

test("the view URL carries both Layer 1 sources as query params", () => {
    const url = new URL(buildViewUrl(9999));
    assert.equal(url.port, "9999");
    assert.equal(url.pathname, "/app/layer1.html");
    assert.ok(url.searchParams.get("dir")?.endsWith("jfred"));
    assert.ok(url.searchParams.get("repo")?.endsWith("jfred"));
});

test("summarize counts violations per state and rule", () => {
    const lines = summarize([
        violation("01-initial-load", "overlapping-nodes", "a"),
        violation("01-initial-load", "overlapping-nodes", "b"),
        violation("06-zoomed-out", "overlapping-nodes", "c"),
    ]);
    assert.deepEqual(lines, [
        "  FAIL 01-initial-load · overlapping-nodes × 2",
        "  FAIL 06-zoomed-out · overlapping-nodes × 1",
    ]);
});

test("listExamples caps each rule so 800 rectangles cannot flood the report", () => {
    const many = Array.from({ length: 50 }, (_, index) => violation("s", "overlapping-nodes", `hit ${index}`));
    const lines = listExamples([...many, violation("s", "wrapped-commit-row", "tall")], 2);
    assert.equal(lines.length, 3);
    assert.match(lines[2]!, /wrapped-commit-row: tall/);
});

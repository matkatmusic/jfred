// Capture-free tests for the Layer 5 real checks. A fake page answers by what the expression reads.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { WireBranchesView } from "../webapp/layer1-wire-branches.ts";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { validateBeforeTick, validateFirstFetch, validateToggle } from "../scripts/visual/layer5-real-checks.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

interface PageAnswers { lanes: number; requests: number; busy?: unknown; paths?: string[]; counts?: unknown }

function buildFakePage(answers: PageAnswers): HeadlessPage {
    const refuse = async () => { throw new Error("the fake page does not do this"); };
    const answer = (expression: string): unknown => {
        if (expression === "window.__busy") return answers.busy;
        if (expression.includes("performance.getEntriesByType")) return answers.requests;
        if (expression === "document.getElementById('busy-shield').hidden") return true;
        if (expression.includes("data-path")) return answers.paths;
        if (expression === "document.querySelectorAll('.blane').length") return answers.lanes;
        if (expression.includes("const off")) return answers.counts;
        return undefined;
    };
    return {
        evaluate: async <T>(expression: string) => answer(expression) as T,
        waitFor: async () => {},
        navigate: refuse,
        screenshot: refuse,
        close: refuse,
    };
}

async function listFailuresOf(run: () => Promise<void>): Promise<string[]> {
    const before = failures.length;
    await run();
    const added = failures.slice(before);
    failures.length = before;
    return added;
}

const PAYLOAD = { pairs: [{ path: "a.ts", branches: [{}, {}] }, { path: "b.ts", branches: [{}] }] } as unknown as WireBranchesView;
const GOOD_BUSY = { shieldShown: true, stripShown: true, labels: ["finding branches 1 / 2", "reconstructing branches 1 / 2"] };

test("validateBeforeTick passes with no lanes and no request", async () => {
    const page = buildFakePage({ lanes: 0, requests: 0 });
    assert.deepEqual(await listFailuresOf(() => validateBeforeTick(page)), []);
});

test("validateBeforeTick fails when a lane or a request already exists", async () => {
    const page = buildFakePage({ lanes: 1, requests: 1 });
    assert.equal((await listFailuresOf(() => validateBeforeTick(page))).length, 2);
});

test("validateFirstFetch passes when the lane count matches the drawn pairs", async () => {
    const page = buildFakePage({ lanes: 2, requests: 1, busy: GOOD_BUSY, paths: ["a.ts"] });
    assert.deepEqual(await listFailuresOf(() => validateFirstFetch(page, PAYLOAD, 1)), []);
});

test("validateFirstFetch fails on the lane count and on labels in the wrong order", async () => {
    const busy = { ...GOOD_BUSY, labels: ["reconstructing branches 1 / 2", "finding branches 1 / 2"] };
    const page = buildFakePage({ lanes: 3, requests: 1, busy, paths: ["a.ts"] });
    assert.deepEqual(await listFailuresOf(() => validateFirstFetch(page, PAYLOAD, 1)), [
        "l5-real the labels read finding branches, then reconstructing branches, as n / m",
        "l5-real the .blane count equals the payload lane count on drawn pairs",
    ]);
});

test("validateToggle passes when untick hides all lanes and re-tick shows them", async () => {
    const page = buildFakePage({ lanes: 2, requests: 1, counts: { off: 0, on: 2 } });
    assert.deepEqual(await listFailuresOf(() => validateToggle(page)), []);
});

test("validateToggle fails when untick leaves lanes visible", async () => {
    const page = buildFakePage({ lanes: 2, requests: 1, counts: { off: 2, on: 2 } });
    assert.deepEqual(await listFailuresOf(() => validateToggle(page)), ["l5-real untick hides every lane, re-tick shows them again"]);
});

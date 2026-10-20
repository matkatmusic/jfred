// Tests for the Layer 2 ruler-row check, using a fake page with canned values.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";
import { validateRulerRow } from "../scripts/visual/layer2-checks-drawer.ts";
import type { ViewPayload } from "../scripts/visual/layer2-payload.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const PAYLOAD: ViewPayload = {
    pairs: [{ path: "a.ts", snapshots: [{ version: 1, sessionId: "s1", sessionFile: "/x/s1.jsonl" }] }],
    diskOrphans: [],
};

function buildFakePage(tickCount: number, rowLabels: string[]): { page: HeadlessPage; expressions: string[]; screenshots: number[] } {
    const expressions: string[] = [];
    const screenshots: number[] = [];
    const page: HeadlessPage = {
        evaluate: async <T>(expression: string) => {
            expressions.push(expression);
            if (expression.includes(".tick.multi').length")) {
                return tickCount as T;
            }
            if (expression.includes("map(b => b.textContent)")) {
                return rowLabels as T;
            }
            return undefined as T;
        },
        waitFor: async () => {},
        navigate: async () => {},
        screenshot: async () => {
            screenshots.push(1);
            return "";
        },
        close: async () => {},
    };
    return { page, expressions, screenshots };
}

test("validateRulerRow fails the #316 check and stops when the ruler has no expandable rows", async () => {
    const before = failures.length;
    const { page, expressions, screenshots } = buildFakePage(0, []);
    await validateRulerRow(page, PAYLOAD);
    assert.equal(failures.length, before + 1);
    assert.match(failures[before] ?? "", /^#316/);
    assert.equal(expressions.length, 1);
    assert.equal(screenshots.length, 0);
    failures.length = before;
});

test("validateRulerRow clicks every expandable row, then fails when none lists a snapshot", async () => {
    const before = failures.length;
    const { page, expressions, screenshots } = buildFakePage(2, ["a.ts @v1", "b.ts @v2"]);
    await validateRulerRow(page, PAYLOAD);
    const rowClicks = expressions.filter((expression) => expression.includes(".tick.multi')[")).length;
    assert.equal(rowClicks, 2);
    assert.deepEqual(failures.slice(before).map((name) => name.slice(0, 4)), ["#316"]);
    assert.equal(screenshots.length, 0);
    failures.length = before;
});

// Tests for layer7-checks.ts: its judges, the fresh-page start, and the two lines that hook it into mockup.ts.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { isMinimapLive, isRangeClear, isRewindDrawnByLayer5Only, validateLayer7 } from "../scripts/visual/layer7-checks.ts";
import { CLICK_SESSION_TOGGLE, TRACK_PRESENT } from "../scripts/visual/layer7-probes.ts";

const MOCKUP_FILE = join(import.meta.dirname, "..", "scripts", "visual", "mockup.ts");

test("test_validateLayer7_starts_on_a_fresh_page_opens_the_session_column_and_then_asks_for_facts", async () => {
    // Steps: stop at the first fact probe; the toggle click and track wait come before it.
    const navigations: string[] = [];
    const steps: string[] = [];
    const page: HeadlessPage = {
        evaluate: async <T>(expression: string): Promise<T> => {
            steps.push(`evaluate ${expression}`);
            if (expression !== CLICK_SESSION_TOGGLE)
                throw new Error(`stop at: ${expression.slice(0, 40)}`);
            return undefined as T;
        },
        waitFor: async (expression: string) => { steps.push(`waitFor ${expression}`); },
        navigate: async (url: string) => { navigations.push(url); },
        screenshot: async () => "", close: async () => {},
    };
    await assert.rejects(validateLayer7(page, "http://127.0.0.1:1/app/layer1.html"), /stop at/);
    assert.deepEqual(navigations, ["http://127.0.0.1:1/app/layer1.html"]);
    assert.equal(steps.length, 4);
    assert.ok(steps[0]!.startsWith("waitFor ") && steps[0]!.includes(".filebox") && steps[0]!.includes("loadbar"));
    assert.equal(steps[1], `evaluate ${CLICK_SESSION_TOGGLE}`);
    assert.equal(steps[2], `waitFor ${TRACK_PRESENT}`);
    assert.ok(steps[3]!.startsWith("evaluate "));
});

test("isRangeClear needs the bar inside the column, left of the first node and on top at its centre", () => {
    const good = { left: 155, right: 162, trackLeft: 152, nodeLeft: 210, isHit: true };
    assert.equal(isRangeClear(good), true);
    assert.equal(isRangeClear({ ...good, left: 140 }), false);
    assert.equal(isRangeClear({ ...good, right: 215 }), false);
    assert.equal(isRangeClear({ ...good, isHit: false }), false);
});

test("isMinimapLive needs a scale and a view box", () => {
    assert.equal(isMinimapLive({ scaleX: 0.02, viewWidth: 30 }), true);
    assert.equal(isMinimapLive({ scaleX: 0, viewWidth: 30 }), false);
    assert.equal(isMinimapLive({ scaleX: Number.NaN, viewWidth: 30 }), false);
    assert.equal(isMinimapLive({ scaleX: 0.02, viewWidth: 0 }), false);
});

test("isRewindDrawnByLayer5Only needs dimmed dots, dashed elbows and no rewind element", () => {
    const good = { bnodeCount: 4, opacity: 0.38, elbowStyle: "dashed", rewindCount: 0 };
    assert.equal(isRewindDrawnByLayer5Only(good), true);
    assert.equal(isRewindDrawnByLayer5Only({ ...good, bnodeCount: 0 }), false);
    assert.equal(isRewindDrawnByLayer5Only({ ...good, opacity: 1 }), false);
    assert.equal(isRewindDrawnByLayer5Only({ ...good, elbowStyle: "solid" }), false);
    assert.equal(isRewindDrawnByLayer5Only({ ...good, rewindCount: 1 }), false);
});

test("mockup.ts imports validateLayer7 and runs it right after validateLayer6", () => {
    const source = readFileSync(MOCKUP_FILE, "utf8");
    assert.ok(source.includes('import { validateLayer7 } from "./layer7-checks.ts";'));
    assert.ok(source.includes("  await validateLayer6(page, pageUrl);\n  await validateLayer7(page, pageUrl);\n"));
});

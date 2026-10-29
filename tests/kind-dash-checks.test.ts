// Tests for validateKindDashes in kind-dash-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { validateKindDashes } from "../scripts/visual/kind-dash-checks.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const buildFakePage = (dashWidth: number): HeadlessPage => {
    const scriptDashCounts = [0, 2, 0];
    return {
        evaluate: async <T>(expression: string) => {
            if (expression.includes("only-child")) {
                return { title: "script run", width: dashWidth, height: 4, visible: true } as T;
            }
            if (expression.includes("kdash-script-run")) {
                return scriptDashCounts.shift() as T;
            }
            if (expression.includes("kdash-commit")) {
                return 0 as T;
            }
            if (expression.includes(".rail")) {
                return [] as T;
            }
            if (expression.includes("length !== 1")) {
                return 0 as T;
            }
            if (expression.includes("length > 1")) {
                return 1 as T;
            }
            if (expression.endsWith(".click()")) {
                return undefined as T;
            }
            return 5 as T;
        },
        waitFor: async () => {},
        navigate: async () => {},
        screenshot: async () => "",
        close: async () => {},
    };
};

const runCollectingFailures = async (page: HeadlessPage): Promise<string[]> => {
    const before = failures.length;
    const log = console.log;
    console.log = () => {};
    try {
        await validateKindDashes(page, "http://127.0.0.1:1/app/layer1.html");
    } finally {
        console.log = log;
    }
    const added = failures.slice(before);
    failures.length = before;
    return added;
};

test("validateKindDashes passes when every dash answer is as expected", async () => {
    assert.deepEqual(await runCollectingFailures(buildFakePage(12)), []);
});

test("validateKindDashes fails the size check when a dash is too wide", async () => {
    const added = await runCollectingFailures(buildFakePage(30));
    assert.deepEqual(added, ["KD a dash measures about 12x4 px and is visible"]);
});

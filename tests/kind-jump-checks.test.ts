// Tests for validateKindJump in kind-jump-checks.ts, using a fake page that steps through three nodes.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { validateKindJump } from "../scripts/visual/kind-jump-checks.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const LAST_POSITION = 2;

const buildFakePage = (landedIsScript: boolean): HeadlessPage => {
    let isTicked = false;
    let position = 1;
    return {
        evaluate: async <T>(expression: string) => {
            if (expression.includes(".map(")) {
                return [!isTicked, !isTicked] as T;
            }
            if (expression.includes("i.node.found")) {
                const landed = { isScript: landedIsScript, onScreen: true, isCentred: true, flashed: true, y: position * 10, boxChecked: true };
                return landed as T;
            }
            if (expression.includes('data-kind="script-run"]\').click()')) {
                isTicked = !isTicked;
                return undefined as T;
            }
            if (expression.includes('data-jump="previous"]\').click()')) {
                position = Math.max(position - 1, 0);
                return undefined as T;
            }
            if (expression.includes('data-jump="next"]\').click()')) {
                position = Math.min(position + 1, LAST_POSITION);
                return undefined as T;
            }
            if (expression.includes('data-jump="previous"]\').disabled')) {
                return (position <= 0) as T;
            }
            if (expression.includes('data-jump="next"]\').disabled')) {
                return (position >= LAST_POSITION) as T;
            }
            return undefined as T;
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
        await validateKindJump(page, "http://127.0.0.1:1/app/layer1.html");
    } finally {
        console.log = log;
    }
    const added = failures.slice(before);
    failures.length = before;
    return added;
};

test("validateKindJump passes when the arrows walk script nodes and end disabled", async () => {
    assert.deepEqual(await runCollectingFailures(buildFakePage(true)), []);
});

test("validateKindJump fails the landing checks when a landing is not a script node", async () => {
    const added = await runCollectingFailures(buildFakePage(false));
    assert.ok(added.includes("KJ every > landing is a script node, on screen and flashed"));
    assert.ok(added.includes("KJ < lands on a script node, on screen and flashed"));
});

// Tests for the Layer 4 drawer checks in layer4-checks-drawer.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import {
    validateBashDrawer, validateConnectorDrawer, validateScriptRunDrawerLayout,
} from "../scripts/visual/layer4-checks-drawer.ts";

const fakePage = (answerFor: (expression: string) => unknown): HeadlessPage => ({
    evaluate: async <T>(expression: string) => answerFor(expression) as T,
    waitFor: async () => {},
    navigate: async () => {},
    screenshot: async () => "",
    close: async () => {},
});

const runCollectingFailures = async (run: () => Promise<void>): Promise<string[]> => {
    const before = failures.length;
    const log = console.log;
    console.log = () => {};
    try {
        await run();
    } finally {
        console.log = log;
    }
    const added = failures.slice(before);
    failures.length = before;
    return added;
};

const layoutState = {
    badgeTitles: ["not verified", "located", "not replayed"],
    titleText: "Verified: ❌ Located: ✅ Replayed: ❌",
    metaText: "src/index.ts src/util.ts",
    panePaths: ["src/index.ts", "src/util.ts"],
    metaTerms: ["line", "tool use id"],
    preWhiteSpace: "pre-wrap", preOverflowY: "auto", preOverflows: false, dlWhiteSpace: "normal",
    metaRows: ["line=83", "tool use id=toolu_fixture_py_rewrite"],
    prov: "line 83 toolu_fixture_py_rewrite",
    hljsSpans: 4,
    titleLabel: "python run rewrite.py", nodeLabel: "python run rewrite.py",
};

test("validateScriptRunDrawerLayout passes for a well-formed python drawer", async () => {
    const page = fakePage(() => layoutState);
    assert.deepEqual(await runCollectingFailures(() => validateScriptRunDrawerLayout(page)), []);
});

test("validateScriptRunDrawerLayout fails when a pictograph or a missing path shows up", async () => {
    const page = fakePage(() => ({ ...layoutState, titleText: "Verified: ❌ Located: ✅ Replayed: ❌ 📍", panePaths: ["src/other.ts"] }));
    assert.equal((await runCollectingFailures(() => validateScriptRunDrawerLayout(page))).length, 2);
});

test("validateBashDrawer passes for a bash drawer with one diff pane", async () => {
    const page = fakePage(() => ({ path: "bash run", preText: "echo hi", panes: 1 }));
    assert.deepEqual(await runCollectingFailures(() => validateBashDrawer(page)), []);
});

test("validateConnectorDrawer fails when the path differs from the python dot", async () => {
    const page = fakePage(() => ({ path: "bash run", preText: "echo hi", panes: 1 }));
    const added = await runCollectingFailures(() => validateConnectorDrawer(page, "python run rewrite.py", "echo hi"));
    assert.equal(added.length, 1);
});

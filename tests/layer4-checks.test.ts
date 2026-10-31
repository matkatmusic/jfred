// Tests for validateLayer4 in layer4-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateLayer4 } from "../scripts/visual/layer4-checks.ts";

const SCREENSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out");
const SCREENSHOT_FILES = ["mockup-07-layer4-nodes.png", "mockup-08-layer4-drawer.png"].map((name) => join(SCREENSHOT_DIR, name));

const drawerState = { path: "orchestrator-dispatch-todo-roundtrip-test.py", preText: "import pathlib", hasHead: true, panes: 2 };
const layoutState = {
    badgeTitles: [], titleText: "", metaText: "", panePaths: [], metaTerms: [], metaRows: [], prov: "", hljsSpans: 0,
};
const lookState = { pythonNodeCount: 0, pythonBubbles: [], pythonLabels: [], pythonRings: [], kinds: [] };
const answerFor = (expression: string): unknown => {
    if (expression.includes("pythonNodeCount"))
        return lookState;
    if (expression.includes("afterUntick"))
        return { afterUntick: {}, afterTick: {}, afterSecondUntick: {}, endsTicked: false };
    if (expression.includes("hasHead"))
        return drawerState;
    if (expression.includes("metaTerms"))
        return layoutState;
    if (expression.includes("centreDeltaY"))
        return {};
    if (expression.includes("scriptRuns"))
        return {};
    if (expression.includes("n-script').length).filter"))
        return [0];
    if (expression.includes("executorKind") || expression.includes(".map(d =>"))
        return [];
    return 0;
};

const navigations: string[] = [];
const fakePage: HeadlessPage = {
    evaluate: async <T>(expression: string) => answerFor(expression) as T,
    waitFor: async () => {},
    navigate: async (url: string) => { navigations.push(url); },
    screenshot: async () => "",
    close: async () => {},
};

test("validateLayer4 runs every group and reloads the page twice", async () => {
    const savedScreenshots = new Map<string, Buffer>();
    for (const file of SCREENSHOT_FILES) {
        if (existsSync(file))
            savedScreenshots.set(file, readFileSync(file));
    }
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    try {
        await validateLayer4(fakePage, "http://page.test/");
    } finally {
        console.log = log;
        failures.length = failuresBefore;
        for (const file of SCREENSHOT_FILES) {
            const saved = savedScreenshots.get(file);
            if (saved === undefined)
                rmSync(file, { force: true });
            else
                writeFileSync(file, saved);
        }
    }
    assert.deepEqual(navigations, ["http://page.test/", "http://page.test/"]);
    assert.ok(lines.some((line) => line.includes("L4 before the box")));
    assert.ok(lines.some((line) => line.includes("L4 the [4] button")));
});

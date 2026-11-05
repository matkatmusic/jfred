// Tests for executeLayer6RealChecks in layer6-real-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { executeLayer6RealChecks } from "../scripts/visual/layer6-real-checks.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";

const SCREENSHOT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-14-layer6-real.png");
const DIALOG_TEXT = "copied files only. no network. Docker container. Docker must be on.";
const target = { origin: "http://127.0.0.1:1", query: "dir=x" };
const picked = { sessionFile: "f.jsonl", toolUseId: "toolu_real" };

const buildFacts = (blocks: string[], state: string, noteTexts: string[]) => ({
    dotClasses: `node n-script run-state-${state}`, isShown: true, blocks, noteTexts, popupText: "Run output", preText: "hello",
    popupRight: 500, drawerLeft: 600,
});

function buildPage(dialogText: string, blocks: string[], state = "verified", noteTexts: string[] = []): HeadlessPage {
    const answerFor = (expression: string): unknown => {
        if (expression.includes("dotClasses"))
            return buildFacts(blocks, state, noteTexts);
        if (expression.includes("count:"))
            return { count: 1, classes: "node n-script never-provable" };
        if (expression.includes("consent-note"))
            return dialogText;
        if (expression.includes("#drawer .run-console-open').length"))
            return 0;
        if (expression.includes(".run-console-open').length"))
            return 1;
        if (expression.includes("run-blocked-popup') !== null"))
            return false;
        if (expression === "window.__runPosts")
            return 0;
        if (expression.includes("run-console')?.textContent"))
            return "";
        return expression.includes("!!(") ? true : undefined;
    };
    return {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async () => {},
        navigate: async () => {},
        screenshot: async () => "",
        close: async () => {},
    };
}

async function runChecks(page: HeadlessPage): Promise<string[]> {
    const savedScreenshot = existsSync(SCREENSHOT_FILE) ? readFileSync(SCREENSHOT_FILE) : undefined;
    const realFetch = globalThis.fetch;
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    globalThis.fetch = async () => new Response(JSON.stringify({ toolUseId: picked.toolUseId, needs: [] }));
    try {
        await executeLayer6RealChecks(page, target, picked, 1_000);
    } finally {
        console.log = log;
        globalThis.fetch = realFetch;
        lines.push(...failures.slice(failuresBefore).map((name) => `FAILED ${name}`));
        failures.length = failuresBefore;
        if (savedScreenshot === undefined)
            rmSync(SCREENSHOT_FILE, { force: true });
        else
            writeFileSync(SCREENSHOT_FILE, savedScreenshot);
    }
    return lines;
}

test("executeLayer6RealChecks passes on good answers", async () => {
    const lines = await runChecks(buildPage(DIALOG_TEXT, ["terminal-block term-verified"]));
    assert.ok(lines.some((line) => line.includes("the dialog text has the box phrases")));
    assert.ok(lines.some((line) => line.includes("a bash drawer has no console button")));
    assert.deepEqual(lines.filter((line) => line.startsWith("FAILED")), []);
});

test("executeLayer6RealChecks turns on the script layer before any scroll or consent read", async () => {
    const page = buildPage(DIALOG_TEXT, ["terminal-block term-verified"]);
    const expressions: string[] = [];
    const answer = page.evaluate;
    page.evaluate = async <T>(expression: string) => { expressions.push(expression); return answer<T>(expression); };
    await runChecks(page);
    const layerClick = expressions.findIndex((expression) => expression.includes("getElementById('layer-4').click()"));
    const firstUse = expressions.findIndex((expression) => expression.includes("scrollIntoView") || expression.includes("consent-note"));
    assert.ok(layerClick >= 0);
    assert.ok(layerClick < firstUse);
});

test("executeLayer6RealChecks accepts the no-proof note and no block for injected-unverified", async () => {
    const note = "Replayed. No proof file was found to compare with.";
    const lines = await runChecks(buildPage(DIALOG_TEXT, [], "injected-unverified", [note]));
    assert.ok(lines.some((line) => line.includes("the no-proof note shows and no terminal block")));
    assert.deepEqual(lines.filter((line) => line.startsWith("FAILED")), []);
    const failedLines = await runChecks(buildPage(DIALOG_TEXT, ["terminal-block term-verified"], "injected-unverified", [note]));
    assert.ok(failedLines.some((line) => line.startsWith("FAILED") && line.includes("no terminal block")));
});

test("executeLayer6RealChecks fails on a missing phrase and a wrong terminal block", async () => {
    const lines = await runChecks(buildPage("copied files only", ["terminal-block term-mismatch"]));
    const failed = lines.filter((line) => line.startsWith("FAILED"));
    assert.ok(failed.some((line) => line.includes("box phrases")));
    assert.ok(failed.some((line) => line.includes("terminal block matches")));
});

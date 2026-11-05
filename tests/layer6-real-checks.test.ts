// Tests for executeLayer6RealChecks in layer6-real-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { createElement, getRequiredElementById } from "../webapp/app-dom.ts";
import { buildMoveTowardDotExpression, buildStateExpression, executeLayer6RealChecks } from "../scripts/visual/layer6-real-checks.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { paintRunDot, resetRunResults, storeRunResult } from "../webapp/layer1-run-results.ts";
import { WireConfidence } from "../webapp/layer1-wire-edits.ts";
import { WireRunOutcome } from "../webapp/layer1-wire-script-results.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

const SCREENSHOT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-14-layer6-real.png");
const DIALOG_TEXT = "copied files only. no network. Docker container. Docker must be on.";
const target = { origin: "http://127.0.0.1:1", query: "dir=x" };
const picked = { sessionFile: "f.jsonl", toolUseId: "toolu_real", changedPaths: ["src/changed.py"] };

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

function drawRunDots(paths: string[] = ["src/changed.py", "src/other.py"]): HTMLElement[] {
    initLayer1Dom();
    const dots: HTMLElement[] = [];
    const bubbles: HTMLElement[] = [];
    for (const path of paths) {
        const dot = createElement("i", { class: "node n-script", "data-tool-use-id": "toolu_real" });
        dots.push(dot);
        bubbles.push(createElement("div", { class: "filebox" }, [createElement("div", { class: "fname", "data-path": path }), dot]));
    }
    getRequiredElementById("stage").replaceChildren(...bubbles);
    return dots;
}

function storeRealResult(confidence: WireConfidence): void {
    const files = [{ path: "src/changed.py", confidence }];
    storeRunResult({ pairs: [], gitOrphans: [], diskOrphans: [], ruler: [] },
        { kind: "script-result", toolUseId: "toolu_real", outcome: WireRunOutcome.replayed, files, stdout: "", stderr: "", timedOut: false, isOutputSaved: true });
}

test("test_buildStateExpression_is_true_when_every_dot_shows_the_run_state_and_the_changed_dot_its_rating", () => {
    resetRunResults();
    drawRunDots();
    storeRealResult(WireConfidence.mismatch);
    assert.equal((0, eval)(buildStateExpression("toolu_real", ["src/changed.py"])), true);
});

test("test_buildStateExpression_is_false_while_the_run_has_no_result", () => {
    resetRunResults();
    drawRunDots();
    assert.equal((0, eval)(buildStateExpression("toolu_real", ["src/changed.py"])), false);
});

test("test_buildStateExpression_is_false_when_the_changed_dot_shows_the_play_triangle", () => {
    resetRunResults();
    const dots = drawRunDots();
    storeRealResult(WireConfidence.verified);
    paintRunDot(dots[0]!, undefined);
    assert.equal((0, eval)(buildStateExpression("toolu_real", ["src/changed.py"])), false);
});

test("test_buildStateExpression_is_false_when_an_unchanged_dot_shows_a_rating", () => {
    resetRunResults();
    const dots = drawRunDots();
    storeRealResult(WireConfidence.verified);
    paintRunDot(dots[1]!, WireConfidence.verified);
    assert.equal((0, eval)(buildStateExpression("toolu_real", ["src/changed.py"])), false);
});

function spyOnScrolls(dots: HTMLElement[]): HTMLElement[] {
    const scrolled: HTMLElement[] = [];
    for (const dot of dots) {
        dot.scrollIntoView = () => { scrolled.push(dot); };
    }
    return scrolled;
}

test("test_buildMoveTowardDotExpression_scrolls_to_the_changed_files_dot_when_it_is_on_the_page", () => {
    const dots = drawRunDots();
    const scrolled = spyOnScrolls(dots);
    assert.equal((0, eval)(buildMoveTowardDotExpression(picked)), true);
    assert.deepEqual(scrolled, [dots[0]]);
});

test("test_buildMoveTowardDotExpression_scrolls_to_another_dot_of_the_run_when_the_changed_dot_is_not_drawn", () => {
    const dots = drawRunDots(["src/other.py"]);
    const scrolled = spyOnScrolls(dots);
    assert.equal((0, eval)(buildMoveTowardDotExpression(picked)), true);
    assert.deepEqual(scrolled, [dots[0]]);
});

test("test_buildMoveTowardDotExpression_returns_false_without_throwing_when_the_run_has_no_dot", () => {
    drawRunDots([]);
    assert.equal((0, eval)(buildMoveTowardDotExpression(picked)), false);
});

test("test_buildStateExpression_is_false_while_the_changed_files_dot_is_not_on_the_page", () => {
    resetRunResults();
    drawRunDots(["src/other.py"]);
    storeRealResult(WireConfidence.verified);
    assert.equal((0, eval)(buildStateExpression("toolu_real", ["src/changed.py"])), false);
});

test("executeLayer6RealChecks fails with a message naming the run and the file when no dot is ever drawn", async () => {
    const page = buildPage(DIALOG_TEXT, ["terminal-block term-verified"]);
    const answer = page.evaluate;
    page.evaluate = async <T>(expression: string) => {
        const isNeverTrue = expression.includes("run-end-replayed") || expression.includes("scrollIntoView");
        return isNeverTrue ? false as T : answer<T>(expression);
    };
    const lines = await runChecks(page);
    const failed = lines.filter((line) => line.startsWith("FAILED"));
    assert.ok(failed.some((line) => line.includes("toolu_real") && line.includes("src/changed.py")), failed.join("\n"));
});

test("executeLayer6RealChecks scrolls to and clicks the dot of the changed file", async () => {
    const page = buildPage(DIALOG_TEXT, ["terminal-block term-verified"]);
    const expressions: string[] = [];
    const answer = page.evaluate;
    let isStateAnswered = false;
    page.evaluate = async <T>(expression: string) => {
        expressions.push(expression);
        const isStateGoal = expression.includes("run-end-replayed") && !isStateAnswered;
        isStateAnswered = isStateAnswered || isStateGoal;
        return isStateGoal ? false as T : answer<T>(expression);
    };
    await runChecks(page);
    const moves = expressions.filter((expression) => expression.includes("scrollIntoView") || (expression.includes(".click()") && expression.includes("data-tool-use-id")));
    assert.equal(moves.filter((expression) => expression.includes("scrollIntoView")).length, 1);
    assert.ok(moves.length > 1);
    assert.deepEqual(moves.filter((expression) => !expression.includes("src/changed.py")), []);
    assert.deepEqual(expressions.filter((expression) => expression.includes(".click()") && expression.includes("[0]")), []);
});

test("executeLayer6RealChecks fails on a missing phrase and a wrong terminal block", async () => {
    const lines = await runChecks(buildPage("copied files only", ["terminal-block term-mismatch"]));
    const failed = lines.filter((line) => line.startsWith("FAILED"));
    assert.ok(failed.some((line) => line.includes("box phrases")));
    assert.ok(failed.some((line) => line.includes("terminal block matches")));
});

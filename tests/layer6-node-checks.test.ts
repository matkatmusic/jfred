// Tests for validateNodeStates in layer6-node-checks.ts, using a fake page with canned answers.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import { validateNodeStates } from "../scripts/visual/layer6-node-checks.ts";
import {
    DERIVED_ID, HIDE_CONSENT, INJECTED_ID, MISMATCH_ID, NEVER_PROVABLE_ID, ORIGINAL_FAILED_ID, PENDING_ID, SHOW_CONSENT, VERIFIED_ID, type NodeFacts,
} from "../scripts/visual/layer6-probes.ts";

const SCREENSHOT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-12-layer6-node-states.png");

const makeNode = (id: string, extraClass: string, index: number): NodeFacts => ({
    // id, classes: `node n-script ${extraClass}`.trim(), width: 15, height: 15,
    id, classes: `node n-script ${extraClass}`.trim(), width: 13, height: 13,
    borderStyle: "solid", borderColor: `rgb(${index}, 0, 0)`, borderWidth: "2px",
    outlineStyle: "none", outlineColor: "rgb(0, 0, 0)", outlineWidth: "0px", backgroundImage: "none",
});
type NodeChanges = Record<string, Partial<NodeFacts>>;
const GOOD_CHANGES: NodeChanges = {
    [MISMATCH_ID]: { outlineStyle: "double", backgroundImage: "radial-gradient(red, red)" },
    [NEVER_PROVABLE_ID]: { borderStyle: "dashed" },
};
const makeGoodNodes = (changes: NodeChanges): NodeFacts[] => {
    const nodes = [
        makeNode(PENDING_ID, "", 1),
        makeNode(VERIFIED_ID, "run-state-verified", 2),
        makeNode(DERIVED_ID, "run-state-derived", 3),
        makeNode(MISMATCH_ID, "run-state-mismatch", 4),
        makeNode(ORIGINAL_FAILED_ID, "run-state-original-failed", 5),
        makeNode(INJECTED_ID, "run-state-injected-unverified", 6),
        makeNode(NEVER_PROVABLE_ID, "never-provable", 7),
    ];
    return nodes.map((node) => ({ ...node, ...GOOD_CHANGES[node.id], ...changes[node.id] }));
};

const consentExpressions: string[] = [];

interface PageAnswers { consoleTotal: number; stateTotal: number; nodes: NodeFacts[]; ruleCount: number; kinds: string[] }
const makeAnswers = (changes: NodeChanges, rest: Partial<PageAnswers> = {}): PageAnswers => ({
    consoleTotal: 0, stateTotal: 5, nodes: makeGoodNodes(changes), ruleCount: 1, kinds: ["edit", "script", "read"], ...rest,
});

const makeFakePage = (answers: PageAnswers, scrolls: string[]): HeadlessPage => {
    const answerFor = (expression: string): unknown => {
        if (expression.includes("run-console-open"))
            return answers.consoleTotal;
        if (expression.includes("scrollIntoView"))
            return scrolls.push(expression);
        if (expression.includes("run-state-"))
            return answers.stateTotal;
        if (expression.includes("getComputedStyle"))
            return answers.nodes;
        if (expression.includes(".never-provable"))
            return answers.ruleCount;
        if (expression.includes("#show-row"))
            return answers.kinds;
        if (expression.includes("run-consent"))
            return consentExpressions.push(expression);
        throw new Error(`unexpected expression: ${expression}`);
    };
    return {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async () => {},
        navigate: async () => {},
        screenshot: async () => "",
        close: async () => {},
    };
};

const runChecks = async (answers: PageAnswers) => {
    const savedScreenshot = existsSync(SCREENSHOT_FILE) ? readFileSync(SCREENSHOT_FILE) : undefined;
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    const scrolls: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    let nodes: NodeFacts[] = [];
    let newFailures: string[] = [];
    try {
        nodes = await validateNodeStates(makeFakePage(answers, scrolls));
        newFailures = failures.slice(failuresBefore);
    } finally {
        console.log = log;
        failures.length = failuresBefore;
        if (savedScreenshot === undefined)
            rmSync(SCREENSHOT_FILE, { force: true });
        else
            writeFileSync(SCREENSHOT_FILE, savedScreenshot);
    }
    return { nodes, lines, scrolls, newFailures };
};

test("validateNodeStates passes every check for the README fixture and returns the nodes", async () => {
    const answers = makeAnswers({});
    const { nodes, lines, scrolls, newFailures } = await runChecks(answers);
    assert.deepEqual(newFailures, []);
    assert.equal(nodes, answers.nodes);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L6")).length, 8);
    assert.equal(scrolls.length, 1);
    assert.ok(lines.some((line) => line.includes("mockup-12-layer6-node-states.png")));
});

test("validateNodeStates hides the consent dialog only around the screenshot", async () => {
    consentExpressions.length = 0;
    await runChecks(makeAnswers({}));
    assert.deepEqual(consentExpressions, [HIDE_CONSENT, SHOW_CONSENT]);
});

test("validateNodeStates fails the before-open check when a run console is already on the page", async () => {
    const { newFailures } = await runChecks(makeAnswers({}, { consoleTotal: 1 }));
    assert.deepEqual(newFailures, ["L6 before any open: no run console and no Open run console button"]);
});

test("validateNodeStates fails the set and state-class checks when a node has the wrong state class", async () => {
    const changes = { [VERIFIED_ID]: { classes: "node n-script run-state-derived" } };
    const { newFailures } = await runChecks(makeAnswers(changes, { stateTotal: 6 }));
    assert.deepEqual(newFailures, [
        "L6 the README.md bubble holds 7 script nodes: pending, 5 states, never-provable",
        "L6 exactly 5 nodes on the page carry a run-state class",
    ]);
});

test("validateNodeStates fails the look checks when two nodes look the same and mismatch has no double outline", async () => {
    const changes = { [DERIVED_ID]: { borderColor: "rgb(2, 0, 0)" }, [MISMATCH_ID]: { outlineStyle: "none" } };
    const { newFailures } = await runChecks(makeAnswers(changes));
    assert.deepEqual(newFailures, [
        "L6 the 7 nodes have 7 different computed looks",
        "L6 mismatch stands out: it alone has a double outline and a filled core",
    ]);
});

test("validateNodeStates fails the reuse and filter checks for a second rule, a solid ring and a state filter", async () => {
    const changes = { [NEVER_PROVABLE_ID]: { borderStyle: "solid" } };
    const { newFailures } = await runChecks(makeAnswers(changes, { ruleCount: 2, kinds: ["edit", "mismatch"] }));
    assert.deepEqual(newFailures, [
        "L6 .never-provable is reused: one rule owns it and its node ring is dashed",
        "L6 the Show row has no filter for states",
    ]);
});

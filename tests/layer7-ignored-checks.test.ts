// Tests for layer7-ignored-checks.ts: the judges directly, and the validators through a stateful fake page.

import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import { failures } from "../scripts/visual/mockup-checks.ts";
import {
    isFilterUntouched, isHideControlRight, isIgnoredRevealed, listColourLiteralRules, validateColourTokens, validateIgnored,
    type IgnoredFacts,
} from "../scripts/visual/layer7-ignored-checks.ts";
import { COLUMN_RULE_TEXTS, IGNORED_FACTS, SCROLL_HOME, buildSetHideIgnored } from "../scripts/visual/layer7-probes.ts";

const SHOT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "visual", "out", "mockup-16-layer7-ignored-shown.png");
const GOOD_RULES = [".anode { border: 2px solid var(--ink); }", ".atrack { background: var(--page); }"];

const HIDDEN: IgnoredFacts = {
    text: "hide ignored nodes", isChecked: true, hasAttribute: true, ignoredCount: 2, ignoredShown: 0, otherShown: 6, opacities: [0.38, 0.38],
    hiddenKinds: "edit script-run branch", kindBoxes: "edit:false,tool:true", requests: 10,
};
const REVEALED: IgnoredFacts = { ...HIDDEN, isChecked: false, hasAttribute: false, ignoredShown: 2 };

interface Setup { hidden: IgnoredFacts; revealed: IgnoredFacts; rules: string[] }
const makeSetup = (change: Partial<Setup> = {}): Setup => ({ hidden: HIDDEN, revealed: REVEALED, rules: GOOD_RULES, ...change });

const makeFakePage = (setup: Setup): HeadlessPage => {
    let isHideOn = true;
    const answerFor = (expression: string): unknown => {
        if (expression === buildSetHideIgnored(false))
            isHideOn = false;
        else if (expression === buildSetHideIgnored(true))
            isHideOn = true;
        else if (expression === IGNORED_FACTS)
            return isHideOn ? setup.hidden : setup.revealed;
        else if (expression === COLUMN_RULE_TEXTS)
            return setup.rules;
        else if (expression !== SCROLL_HOME)
            throw new Error(`unexpected expression: ${expression}`);
        return undefined;
    };
    return {
        evaluate: async <T>(expression: string) => answerFor(expression) as T,
        waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
    };
};

const runChecks = async (setup: Setup) => {
    const savedShot = existsSync(SHOT) ? readFileSync(SHOT) : undefined;
    const failuresBefore = failures.length;
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => { lines.push(line); };
    let newFailures: string[] = [];
    try {
        const page = makeFakePage(setup);
        await validateIgnored(page);
        await validateColourTokens(page);
        newFailures = failures.slice(failuresBefore);
    } finally {
        console.log = log;
        failures.length = failuresBefore;
        if (savedShot === undefined)
            rmSync(SHOT, { force: true });
        else
            writeFileSync(SHOT, savedShot);
    }
    return { lines, newFailures };
};

test("the ignored checks pass the good page: 5 checks and one screenshot", async () => {
    const { lines, newFailures } = await runChecks(makeSetup());
    assert.deepEqual(newFailures, []);
    assert.equal(lines.filter((line) => line.startsWith("PASS  L7")).length, 5);
    assert.ok(lines.some((line) => line.includes("mockup-16-layer7-ignored-shown.png")));
});

test("a wrong label fails the first and the reticked check", async () => {
    const { newFailures } = await runChecks(makeSetup({ hidden: { ...HIDDEN, text: "hide ignored" } }));
    assert.equal(newFailures.length, 2);
    assert.match(newFailures[0]!, /exact label/);
    assert.match(newFailures[1]!, /reticking/);
});

test("an undimmed ignored node fails only the revealed check", async () => {
    const { newFailures } = await runChecks(makeSetup({ revealed: { ...REVEALED, opacities: [1, 0.38] } }));
    assert.deepEqual(newFailures, ["L7 unticking shows both ignored nodes dimmed and leaves the other nodes alone"]);
});

test("a changed number of other nodes fails only the revealed check", async () => {
    const { newFailures } = await runChecks(makeSetup({ revealed: { ...REVEALED, otherShown: 5 } }));
    assert.deepEqual(newFailures, ["L7 unticking shows both ignored nodes dimmed and leaves the other nodes alone"]);
});

test("a request or a kind change during the toggle fails only the quiet check", async () => {
    const requested = await runChecks(makeSetup({ revealed: { ...REVEALED, requests: 11 } }));
    assert.deepEqual(requested.newFailures, ["L7 the toggle leaves hidden kinds, kind boxes and requests as they were"]);
    const filtered = await runChecks(makeSetup({ revealed: { ...REVEALED, hiddenKinds: "edit" } }));
    assert.deepEqual(filtered.newFailures, ["L7 the toggle leaves hidden kinds, kind boxes and requests as they were"]);
});

test("a colour literal or no rule at all fails the token check", async () => {
    const hex = await runChecks(makeSetup({ rules: [...GOOD_RULES, ".tnode { border-color: #fff; }"] }));
    assert.deepEqual(hex.newFailures, ["L7 the new rules hold no colour literal, so dark mode follows the tokens"]);
    const rgb = await runChecks(makeSetup({ rules: [".alabel { color: rgb(1, 2, 3); }"] }));
    assert.equal(rgb.newFailures.length, 1);
    const none = await runChecks(makeSetup({ rules: [] }));
    assert.equal(none.newFailures.length, 1);
});

test("the judges refuse a third ignored node, a visible ignored node and a changed filter", () => {
    assert.equal(isHideControlRight(HIDDEN), true);
    assert.equal(isHideControlRight({ ...HIDDEN, ignoredCount: 3 }), false);
    assert.equal(isHideControlRight({ ...HIDDEN, ignoredShown: 1 }), false);
    assert.equal(isHideControlRight({ ...HIDDEN, isChecked: false }), false);
    assert.equal(isIgnoredRevealed(HIDDEN, REVEALED), true);
    assert.equal(isIgnoredRevealed(HIDDEN, { ...REVEALED, ignoredShown: 1 }), false);
    assert.equal(isIgnoredRevealed(HIDDEN, { ...REVEALED, opacities: [] }), false);
    assert.equal(isFilterUntouched(HIDDEN, { ...HIDDEN, kindBoxes: "edit:true" }), false);
});

test("listColourLiteralRules keeps hex, rgb and hsl rules and drops token rules", () => {
    const found = listColourLiteralRules([...GOOD_RULES, "a { color: #abc; }", "b { color: hsla(1, 2%, 3%, 1); }", "c { color: rgba(0,0,0,.5); }"]);
    assert.equal(found.length, 3);
    assert.deepEqual(listColourLiteralRules(GOOD_RULES), []);
});

// Tests for layer9-checks.ts: its judges, the fresh-page start, and the two lines that hook it into mockup.ts.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type HeadlessPage } from "../scripts/visual/cdp.ts";
import {
    isButtonRight, isCannedColumn, isMessageRight, isScreenshotBig, listMessageSnapLines, readSkippedCount, validateButton, validateCannedColumn,
    validateCannedMessages, validateLayer9, type ButtonFacts,
} from "../scripts/visual/layer9-checks.ts";
import {
    BUTTON_FACTS, CHAIN_COUNT, COMMIT_MODE_CLICK, DRAWER_FACTS, ENTRY_FACTS, STRIP_COUNT, buildBeaconInstantCount, buildClickById, buildClickEntry, buildSnapLines,
    type DrawerFacts, type EntryFacts,
} from "../scripts/visual/layer9-probes.ts";
import { makeScriptedPage, runCheck } from "./layer9-fake-page.ts";

const MOCKUP_FILE = join(import.meta.dirname, "..", "scripts", "visual", "mockup.ts");
const LAYER9_FILE = join(import.meta.dirname, "..", "scripts", "visual", "layer9-checks.ts");
const makeEntry = (kind: string, shortHash: string, parentHash: string | null, instant: string, cy = 100): EntryFacts => ({ kind, shortHash, parentHash, instant, cx: 650, cy, tickCy: cy });
const BASE_AT = "2026-06-01T09:00:00.000Z";
const FIRST_AT = "2026-06-01T09:05:00.000Z";
const SECOND_AT = "2026-06-03T10:30:00.000Z";
const CANNED = [makeEntry("base", "a1b2c3d4", null, BASE_AT), makeEntry("commit", "c0ffee01", "a1b2c3d4", FIRST_AT), makeEntry("commit", "c0ffee02", "c0ffee01", SECOND_AT)];
const FIRST_LINES = ["src/index.ts: @v2 at 2026-06-01T09:05:00.000Z", "README.md: a1b2c3d4 at 2026-06-01T09:00:00.000Z"];
const SECOND_LINES = ["src/index.ts: e4f5a6b7 at 2026-06-01T14:30:00.000Z"];
const FOOT = "Author-Date: X\nCommit-Date: Y\nreconstructed by JFRED @ Y";
const FIRST_TEXT = `jfred: reconstruct to X\n\n${FIRST_LINES.join("\n")}\n\n${FOOT}`;
const SECOND_TEXT = `jfred: reconstruct to X\n\nincludes 2 unmarked changes\n\n${SECOND_LINES.join("\n")}\n\n${FOOT}`;
const GOOD_BUTTON: ButtonFacts = { text: "Commit mode", previousId: "project-settings", isHidden: false, display: "block", isSettingsOpen: false, isInShowRow: false };

const failuresOf = async (check: () => Promise<void>) => (await runCheck(check)).newFailures;

test("test_validate_layer9_starts_on_a_fresh_page_and_runs_validateRulerUi_first", async () => {
    // Setup: a page that records each navigation and wait, and stops at its first evaluate.
    const navigations: string[] = [];
    const waits: string[] = [];
    const expressions: string[] = [];
    const page: HeadlessPage = {
        evaluate: async <T>(expression: string): Promise<T> => { expressions.push(expression); throw new Error(`stop at: ${expression.slice(0, 40)}`); },
        waitFor: async (expression: string) => { waits.push(expression); },
        navigate: async (url: string) => { navigations.push(url); },
        screenshot: async () => "", close: async () => {},
    };
    await assert.rejects(validateLayer9(page, "http://127.0.0.1:1/app/layer1.html"), /stop at/);
    // The page loads once and waits for the stage and an idle load bar.
    assert.deepEqual(navigations, ["http://127.0.0.1:1/app/layer1.html"]);
    assert.equal(waits.length, 1);
    assert.ok(waits[0]!.includes(".filebox"));
    assert.ok(waits[0]!.includes("loadbar"));
    // The first expression is the error hook that validateRulerUi installs, so it runs on the fresh page.
    assert.equal(expressions.length, 1);
    assert.ok(expressions[0]!.includes("__rulerErrors"));
});

test("test_validate_layer9_calls_validateRulerUi_right_after_the_first_fresh_page_wait", () => {
    // The source imports validateRulerUi from the ruler UI commit checks.
    const source = readFileSync(LAYER9_FILE, "utf8");
    assert.ok(source.includes('import { validateRulerUi } from "./ruler-ui-commit-checks.ts";'));
    // The call comes straight after the first waitForFreshPage and before the canned page checks.
    assert.ok(source.includes("  await waitForFreshPage(page, pageUrl);\n  await validateRulerUi(page);\n  await validateCannedPage(page);\n"));
});

test("test_commit_mode_is_off_for_the_off_paint_check_and_the_session_column_is_on_for_the_session_checks", () => {
    const source = readFileSync(LAYER9_FILE, "utf8");
    // Commit mode is on after the canned column, so the flow clicks it off before the off-paint check.
    assert.ok(source.includes("  await page.evaluate(COMMIT_MODE_CLICK);\n  await validateUnarmedPaint(page);\n"));
    // The session column is opened before the session-on layout, overlap and stacking checks.
    assert.ok(source.includes("  await openSessionColumn(page);\n  await validateStripBesideSession(page);\n  await validateStripOverlaps(page, true);\n  await validateLineBehindDot(page);\n"));
    // The session-off layout and overlap checks run before the column is opened.
    assert.ok(source.indexOf("await validateStripOverlaps(page, false);") < source.indexOf("await openSessionColumn(page);"));
});

const buildColumnAnswers =(entries: EntryFacts[], chains: number, stripCountAtLoad: number) => new Map<string, unknown[]>([
    [ENTRY_FACTS, [entries]], [CHAIN_COUNT, [chains]], [STRIP_COUNT, [stripCountAtLoad]], [COMMIT_MODE_CLICK, []],
]);

test("validateCannedColumn passes the canned column and fails each single bad fact", async () => {
    const run = (entries: EntryFacts[], chains = 2, stripCountAtLoad = 0) => failuresOf(async () => { await validateCannedColumn(makeScriptedPage(buildColumnAnswers(entries, chains, stripCountAtLoad))); });
    assert.deepEqual(await run(CANNED), []);
    assert.equal((await run(CANNED, 1)).length, 1);
    assert.equal((await run([CANNED[0]!, CANNED[1]!])).length, 1);
    assert.equal((await run([CANNED[0]!, CANNED[1]!, makeEntry("commit", "c0ffee02", "a1b2c3d4", SECOND_AT)])).length, 1);
    assert.equal((await run([CANNED[0]!, CANNED[1]!, { ...CANNED[2]!, tickCy: 140 }])).length, 1);
    assert.equal(isCannedColumn([makeEntry("commit", "a1b2c3d4", null, BASE_AT), CANNED[1]!, CANNED[2]!], 2), false);
});

test("test_canned_column_is_absent_at_load_then_appears_after_the_commit_mode_click", async () => {
    // Setup: a fake page that records the order of three expressions.
    const order: string[] = [];
    const page = makeScriptedPage(buildColumnAnswers(CANNED, 2, 0));
    const original = page.evaluate.bind(page);
    page.evaluate = async <T>(expression: string): Promise<T> => {
        if (expression === STRIP_COUNT || expression === COMMIT_MODE_CLICK || expression === ENTRY_FACTS)
            order.push(expression);
        return (await original(expression)) as T;
    };
    // The check asks for the strip count, clicks Commit mode, then reads the entries.
    assert.deepEqual(await failuresOf(async () => { await validateCannedColumn(page); }), []);
    assert.deepEqual(order.slice(0, 3), [STRIP_COUNT, COMMIT_MODE_CLICK, ENTRY_FACTS]);
    // A strip that is already on the page at load fails exactly one check.
    const earlyStrip = () => validateCannedColumn(makeScriptedPage(buildColumnAnswers(CANNED, 2, 1)));
    assert.equal((await failuresOf(async () => { await earlyStrip(); })).length, 1);
});

interface MessageSetup { one: DrawerFacts; two: DrawerFacts; oneLines: string[]; twoLines: string[]; independent: number }
const GOOD_MESSAGES: MessageSetup = {
    one: { isOpen: true, text: FIRST_TEXT, hasButton: false }, two: { isOpen: true, text: SECOND_TEXT, hasButton: false }, oneLines: FIRST_LINES, twoLines: SECOND_LINES, independent: 2,
};
const runMessages = (change: Partial<MessageSetup> = {}) => {
    const setup = { ...GOOD_MESSAGES, ...change };
    const answers = new Map<string, unknown[]>([
        [DRAWER_FACTS, [setup.one, setup.two]], [buildSnapLines(FIRST_AT), [setup.oneLines]], [buildSnapLines(SECOND_AT), [setup.twoLines]],
        [buildBeaconInstantCount(FIRST_AT, SECOND_AT), [setup.independent]], [buildClickEntry("c0ffee01"), []], [buildClickById("dclose"), []],
    ]);
    return failuresOf(() => validateCannedMessages(makeScriptedPage(answers), CANNED));
};

test("validateCannedMessages passes the canned messages: 3 checks", async () => {
    assert.deepEqual(await runMessages(), []);
});

test("a stale file line, a missing footnote or a wrong count fails the matching message check", async () => {
    assert.equal((await runMessages({ oneLines: [FIRST_LINES[0]!] })).length, 1);
    assert.equal((await runMessages({ twoLines: [] })).length, 1);
    assert.equal((await runMessages({ independent: 3 })).length, 1);
    assert.equal((await runMessages({ one: { isOpen: true, text: `${FIRST_TEXT}\nx`, hasButton: false } })).length, 1);
    assert.equal((await runMessages({ one: { isOpen: true, text: `${FIRST_TEXT}\n\nincludes 1 unmarked changes`, hasButton: false } })).length, 1);
    assert.equal((await runMessages({ two: { isOpen: false, text: SECOND_TEXT, hasButton: false } })).length, 1);
    assert.equal((await runMessages({ two: { isOpen: true, text: SECOND_TEXT.replace("includes 2", "includes 1"), hasButton: false } })).length, 1);
});

test("the message parsers split a message into file lines and read the skipped count", () => {
    assert.deepEqual(listMessageSnapLines(SECOND_TEXT), SECOND_LINES);
    assert.equal(readSkippedCount(SECOND_TEXT), 2);
    assert.equal(readSkippedCount(FIRST_TEXT), undefined);
    assert.equal(isMessageRight({ isOpen: true, text: SECOND_TEXT.replace("Commit-Date: Y\n", ""), hasButton: false }, SECOND_LINES), false);
});

test("validateButton and its judge need the exact text, the place and a visible button at first load", async () => {
    const run = (facts: ButtonFacts) => failuresOf(() => validateButton(makeScriptedPage(new Map([[BUTTON_FACTS, [facts]]]))));
    assert.deepEqual(await run(GOOD_BUTTON), []);
    for (const change of [{ text: "Commit Mode" }, { previousId: "time-author" }, { isHidden: true }, { display: "none" }, { isSettingsOpen: true }, { isInShowRow: true }])
        assert.equal((await run({ ...GOOD_BUTTON, ...change })).length, 1, JSON.stringify(change));
    assert.equal(isButtonRight(GOOD_BUTTON), true);
});

test("a screenshot must be larger than 10 KB", () => {
    assert.equal(isScreenshotBig(10 * 1024), false);
    assert.equal(isScreenshotBig(10 * 1024 + 1), true);
});

test("mockup.ts imports validateLayer9 and runs it right after validateLayer7", () => {
    const source = readFileSync(MOCKUP_FILE, "utf8");
    assert.ok(source.includes('import { validateLayer9 } from "./layer9-checks.ts";'));
    assert.ok(source.includes("  await validateLayer7(page, pageUrl);\n  await validateLayer9(page, pageUrl);\n"));
});

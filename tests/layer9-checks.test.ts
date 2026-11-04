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
    BUTTON_FACTS, CHAIN_COUNT, DRAWER_FACTS, ENTRY_FACTS, buildBeaconInstantCount, buildClickById, buildClickEntry, buildSnapLines, type DrawerFacts, type EntryFacts,
} from "../scripts/visual/layer9-probes.ts";
import { makeScriptedPage, runCheck } from "./layer9-fake-page.ts";

const MOCKUP_FILE = join(import.meta.dirname, "..", "scripts", "visual", "mockup.ts");
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

test("validateLayer9 starts on a fresh page and then asks the page for facts", async () => {
    const navigations: string[] = [];
    const waits: string[] = [];
    const page: HeadlessPage = {
        evaluate: async <T>(expression: string): Promise<T> => { throw new Error(`stop at: ${expression.slice(0, 40)}`); },
        waitFor: async (expression: string) => { waits.push(expression); },
        navigate: async (url: string) => { navigations.push(url); },
        screenshot: async () => "", close: async () => {},
    };
    await assert.rejects(validateLayer9(page, "http://127.0.0.1:1/app/layer1.html"), /stop at/);
    assert.deepEqual(navigations, ["http://127.0.0.1:1/app/layer1.html"]);
    assert.equal(waits.length, 1);
    assert.ok(waits[0]!.includes(".filebox"));
    assert.ok(waits[0]!.includes("loadbar"));
});

test("validateCannedColumn passes the canned column and fails each single bad fact", async () => {
    const run = (entries: EntryFacts[], chains = 2) => failuresOf(async () => { await validateCannedColumn(makeScriptedPage(new Map<string, unknown[]>([[ENTRY_FACTS, [entries]], [CHAIN_COUNT, [chains]]]))); });
    assert.deepEqual(await run(CANNED), []);
    assert.equal((await run(CANNED, 1)).length, 1);
    assert.equal((await run([CANNED[0]!, CANNED[1]!])).length, 1);
    assert.equal((await run([CANNED[0]!, CANNED[1]!, makeEntry("commit", "c0ffee02", "a1b2c3d4", SECOND_AT)])).length, 1);
    assert.equal((await run([CANNED[0]!, CANNED[1]!, { ...CANNED[2]!, tickCy: 140 }])).length, 1);
    assert.equal(isCannedColumn([makeEntry("commit", "a1b2c3d4", null, BASE_AT), CANNED[1]!, CANNED[2]!], 2), false);
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

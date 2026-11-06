// Layer 9 checks on the fixture-mode page; validateLayer9 leaves a fresh page behind.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { validateCommitSurvivesRerender, validateDeleteAndRebase } from "./layer9-branch-checks.ts";
import {
  validateArmedPaint, validateCommit, validateNormalClick, validatePendingMark, validateRefusals, validateUnarmedPaint, validateUnchangedRange,
} from "./layer9-flow-checks.ts";
import {
  isEntryLevelWithTick, validateSlack, validateStripBesideSession, validateStripLayout, validateStripOverlaps, validateTokens,
} from "./layer9-layout-checks.ts";
import { SCROLL_HOME, openSessionColumn } from "./layer7-probes.ts";
// import { validateLineBehindText } from "./layer9-stacking-checks.ts";
import { validateLineBehindDot } from "./layer9-stacking-checks.ts";
import { DISMISS_RUN_CONSENT, validateRulerUi } from "./ruler-ui-commit-checks.ts";
import {
  BUTTON_FACTS, CHAIN_COUNT, COMMIT_MODE_CLICK, COMMIT_MODE_LABEL, DRAWER_FACTS, ENTRY_FACTS, FIXTURE_BASE_HASH, FOOTNOTE_PREFIX, STRIP_COUNT,
  buildBeaconInstantCount, buildClickById, buildClickEntry, buildSnapLines, type DrawerFacts, type EntryFacts,
} from "./layer9-probes.ts";
import { JfredEntryKind } from "../../webapp/layer1-components/commits-column/layer1-jfred-entries.ts";

export interface ButtonFacts { text: string; previousId: string; isHidden: boolean; display: string; isSettingsOpen: boolean; isInShowRow: boolean }

const OUT_DIR = join(import.meta.dirname, "out");
const MIN_SCREENSHOT_BYTES = 10 * 1024;
const SCREENSHOTS = { strip: "18-layer9-strip", armed: "19-layer9-armed", pending: "20-layer9-pending" };
const SKIPPED_LINE = /^includes (\d+) unmarked changes$/m;
const NON_SNAP_LINE = /^(jfred: |includes |Author-Date: |Commit-Date: |reconstructed by JFRED @ )|^$/;

export function isCannedColumn(entries: EntryFacts[], chains: number): boolean {
  const [base, first, second] = entries;
  const kinds = entries.length === 3 && base!.kind === JfredEntryKind.base && first!.kind === JfredEntryKind.commit && second!.kind === JfredEntryKind.commit;
  const isGrowingPrefix = kinds && first!.parentHash === base!.shortHash && second!.parentHash === first!.shortHash;
  return isGrowingPrefix && base!.shortHash === FIXTURE_BASE_HASH && second!.parentHash !== base!.shortHash && chains === 2;
}

export function listMessageSnapLines(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (!NON_SNAP_LINE.test(line))
      lines.push(line);
  }
  return lines;
}

export function readSkippedCount(text: string): number | undefined {
  const found = SKIPPED_LINE.exec(text);
  return found === null ? undefined : Number(found[1]);
}

export function isMessageRight(drawer: DrawerFacts, pageLines: string[]): boolean {
  const lines = drawer.text.split("\n");
  const isEnded = lines.at(-1)!.startsWith(FOOTNOTE_PREFIX) && lines.some((line) => line.startsWith("Author-Date: "));
  const isStamped = lines.some((line) => line.startsWith("Commit-Date: "));
  return drawer.isOpen && isEnded && isStamped && JSON.stringify(listMessageSnapLines(drawer.text)) === JSON.stringify(pageLines);
}

export function isButtonRight(facts: ButtonFacts): boolean {
  const isPlaced = facts.text === COMMIT_MODE_LABEL && facts.previousId === "project-settings" && !facts.isInShowRow;
  return isPlaced && !facts.isHidden && facts.display !== "none" && !facts.isSettingsOpen;
}

export function isScreenshotBig(size: number): boolean {
  return size > MIN_SCREENSHOT_BYTES;
}

async function readCommitMessage(page: HeadlessPage, entry: EntryFacts): Promise<{ drawer: DrawerFacts; pageLines: string[] }> {
  await page.evaluate(buildClickEntry(entry.shortHash!));
  const drawer = await page.evaluate<DrawerFacts>(DRAWER_FACTS);
  return { drawer, pageLines: await page.evaluate<string[]>(buildSnapLines(entry.instant)) };
}

// Commit mode is off at load; the click turns it on before the entries are read.
export async function validateCannedColumn(page: HeadlessPage): Promise<EntryFacts[]> {
  const stripCountAtLoad = await page.evaluate<number>(STRIP_COUNT);
  reportCheck("L9 at load Commit mode is off and the page has no #jfred-strip", stripCountAtLoad === 0, stripCountAtLoad);
  await page.evaluate(COMMIT_MODE_CLICK);
  await page.evaluate(DISMISS_RUN_CONSENT);
  const entries = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  reportCheck("L9 after the Commit mode click the canned column holds the base and two commits, each parent is the one before, and two chains join them", isCannedColumn(entries, await page.evaluate<number>(CHAIN_COUNT)), entries);
  reportCheck("L9 every canned entry shares a centre line with its ruler tick", isEntryLevelWithTick(entries), entries);
  return entries;
}

export async function validateCannedMessages(page: HeadlessPage, entries: EntryFacts[]): Promise<void> {
  const [, first, second] = entries;
  const one = await readCommitMessage(page, first!);
  reportCheck("L9 commit 1: no unmarked line, footnote last, file lines equal a fresh listSnapLines", isMessageRight(one.drawer, one.pageLines) && !one.drawer.text.includes("unmarked"), one);
  const two = await readCommitMessage(page, second!);
  reportCheck("L9 commit 2: footnote last, file lines equal a fresh listSnapLines", isMessageRight(two.drawer, two.pageLines), two);
  const independent = await page.evaluate<number>(buildBeaconInstantCount(first!.instant, second!.instant));
  const isCounted = readSkippedCount(two.drawer.text) === independent;
  reportCheck("L9 commit 2 says includes N unmarked changes, and N equals the count of beacon instants between the marks", isCounted, [independent, two.drawer.text]);
  await page.evaluate(buildClickById("dclose"));
}

export async function validateButton(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<ButtonFacts>(BUTTON_FACTS);
  reportCheck("L9 Commit mode: exact text, right after project settings, not in the show row, on screen at first load", isButtonRight(facts), facts);
}

export function validateScreenshots(): void {
  for (const name of Object.values(SCREENSHOTS)) {
    const file = join(OUT_DIR, `mockup-${name}.png`);
    reportCheck(`L9 screenshot ${name} is written and larger than 10 KB`, existsSync(file) && isScreenshotBig(statSync(file).size), file);
  }
}

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

async function shoot(page: HeadlessPage, name: string): Promise<void> {
  await saveScreenshot(page, name);
  console.log(`L9 screenshot: scripts/visual/out/mockup-${name}.png`);
}

// async function validateCannedPage(page: HeadlessPage): Promise<void> {
//   await validateButton(page);
//   const entries = await validateCannedColumn(page);
//   await shoot(page, SCREENSHOTS.strip);
//   await validateCannedMessages(page, entries);
//   await validateStripLayout(page);
//   await validateStripOverlaps(page);
//   await validateLineBehindText(page);
//   await validateTokens(page);
//   await validateSlack(page);
// }

// Commit mode is on after the canned column; the session column is off until the middle of this function.
async function validateCannedPage(page: HeadlessPage): Promise<void> {
  await validateButton(page);
  const entries = await validateCannedColumn(page);
  await shoot(page, SCREENSHOTS.strip);
  await validateCannedMessages(page, entries);
  await validateStripLayout(page);
  await validateStripOverlaps(page, false);
  await validateTokens(page);
  await validateSlack(page);
  await openSessionColumn(page);
  await validateStripBesideSession(page);
  await validateStripOverlaps(page, true);
  await validateLineBehindDot(page);
}

// Commit mode is on and armed: refusals, the unchanged-range question, the pending mark, then Commit.
async function validateMarkFlow(page: HeadlessPage): Promise<void> {
  await validateRefusals(page);
  await validateUnchangedRange(page);
  await validatePendingMark(page);
  await shoot(page, SCREENSHOTS.pending);
  await validateCommit(page);
}

// Commit mode is on when this runs; the first click turns it off.
async function validateCommitMode(page: HeadlessPage): Promise<void> {
  await page.evaluate(COMMIT_MODE_CLICK);
  await validateUnarmedPaint(page);
  await validateNormalClick(page, "L9 Commit mode off: a click on a two-event tick opens its file list and a second click closes it");
  await validateArmedPaint(page);
  await page.evaluate(SCROLL_HOME);
  await shoot(page, SCREENSHOTS.armed);
  await validateMarkFlow(page);
  await validateCommitSurvivesRerender(page);
  await validateDeleteAndRebase(page);
  await validateNormalClick(page, "L9 with Commit mode off again, a click on a two-event tick opens its file list as before");
}

// validateRulerUi needs the fresh page, clicks Delete and the time toggle, and ends on a reloaded fresh page.
export async function validateLayer9(page: HeadlessPage, pageUrl: string): Promise<void> {
  await waitForFreshPage(page, pageUrl);
  await validateRulerUi(page);
  await validateCannedPage(page);
  await validateCommitMode(page);
  validateScreenshots();
  await waitForFreshPage(page, pageUrl);
}

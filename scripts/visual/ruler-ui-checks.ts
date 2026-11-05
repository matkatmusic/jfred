// Ruler UI checks for mockup 1 (default) and mockup 2 (a clicked row). validateRulerUi lives in ruler-ui-commit-checks.ts.

import { type HeadlessPage } from "./cdp.ts";
import { isNear } from "./layer7-facts.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import {
  COLOUR_FACTS, DASH_FACTS, ESCAPE_CLOSE, EXPAND_CLICK, FIXTURE_TICK_COUNT, HEAD_FACTS, HEAD_SCROLL_FACTS, LAYOUT_FACTS, QUIET_FACTS, RULER_UI_SCREENSHOTS,
  SCROLL_EXPANDED, SINGLE_CLICK, TICK_TEXT_FACTS, type Box,
} from "./ruler-ui-probes.ts";

export interface HeadFacts { isFirstChild: boolean; headButtons: number; headText: string; hasJfredButton: boolean; trackCount: number; stripCount: number }
export interface ColourFacts { coloured: number; withProperty: number }
interface HeadAt { height: number; offset: number; borderStyle: string; tickTop: number }
export interface HeadScrollFacts { home: HeadAt; scrolled: HeadAt }
export interface TickTextFacts { leaders: number; ticks: { time: string; count: string; fullTime: string; title: string }[] }
export interface DashFacts { time: Box; dashes: Box; axisY: number }
export interface LayoutFacts { rulerWidth: number; isBeforeStage: boolean; gap: number; expectedGap: number }
export interface ExpandFacts {
  isExpanded: boolean; countDisplay: string; expectedCount: number; time: Box; dashes: Box; dashColors: Record<string, string>; ink: string;
  buttons: { text: string; kind: string; color: string }[]; listHeight: number; nextBefore: number; nextAfter: number;
}
export interface ClosedFacts { expanded: number; tickFiles: number }
export interface SingleFacts { tickFiles: number; found: number; foundBoxes: number }
export interface QuietFacts { errors: number; isIdle: boolean }
const TIME_PATTERN = /^\d\d-\d\d-\d{4}:\d\d:\d\d$/;
const COUNT_PATTERN = /^\(\d+\)$/;
const FULL_TIME_PATTERN = /^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/;
const FILE_LINE_PATTERN = /^\S+ {2}(?:[0-9a-f]{8}|@v\d+ 📸|created at)$/u;
const FILE_KIND_PREFIX = "tf-";
const HEAD_HEIGHT_PX = 44;
const RULER_WIDTH_PX = 152;
export const EDGE_PX = 0.5;
export const LEVEL_PX = 1;
const BAND_PX = 3;
const BELOW_SLACK_PX = 2; // a time span's line box may end past the tick, where the dashes start
const centreY = (box: Box) => (box.top + box.bottom) / 2;
export const isHeadRight = (f: HeadFacts) =>
  f.isFirstChild && f.headButtons === 1 && f.headText === "session" && !f.hasJfredButton && f.trackCount === 0 && f.stripCount === 0;
export const isRowsPlain = (f: ColourFacts) => f.coloured === 0 && f.withProperty === 0;
export function isHeadFixed({ home, scrolled }: HeadScrollFacts): boolean {
  const isTall = isNear(home.height, HEAD_HEIGHT_PX, EDGE_PX) && isNear(scrolled.height, HEAD_HEIGHT_PX, EDGE_PX);
  const isDotted = home.borderStyle === "dotted" && scrolled.borderStyle === "dotted";
  return isTall && isDotted && isNear(home.offset, scrolled.offset, EDGE_PX) && Math.abs(home.tickTop - scrolled.tickTop) > LEVEL_PX;
}

export function isRowTextRight({ ticks }: TickTextFacts): boolean {
  let isRight = ticks.length > 0;
  for (const tick of ticks) {
    const isTextRight = TIME_PATTERN.test(tick.time) && COUNT_PATTERN.test(tick.count) && FULL_TIME_PATTERN.test(tick.fullTime);
    isRight &&= isTextRight && tick.title === tick.fullTime;
  }
  return isRight;
}

export function isRowCountRight({ leaders, ticks }: TickTextFacts): boolean {
  const fullTimes = new Set<string>();
  for (const tick of ticks) {
    fullTimes.add(tick.fullTime);
  }
  return ticks.length === leaders && leaders === FIXTURE_TICK_COUNT && fullTimes.size === ticks.length;
}

export function isEveryDashBelowTime(list: DashFacts[]): boolean {
  let isRight = list.length > 0;
  for (const { time, dashes, axisY } of list) {
    const isBelow = dashes.top >= time.bottom - BELOW_SLACK_PX;
    const isInside = dashes.left >= time.left - EDGE_PX && dashes.right <= time.right + EDGE_PX;
    isRight &&= isBelow && isInside && isNear(centreY(time), axisY, LEVEL_PX);
  }
  return isRight;
}

export const isLayoutRight = (f: LayoutFacts) => isNear(f.rulerWidth, RULER_WIDTH_PX, EDGE_PX) && f.isBeforeStage && isNear(f.gap, f.expectedGap, EDGE_PX);

export function isExpandedRight(f: ExpandFacts): boolean {
  const isRowOpen = f.isExpanded && f.countDisplay === "none" && f.expectedCount > 1 && f.buttons.length === f.expectedCount;
  return isRowOpen && f.dashes.left >= f.time.right - EDGE_PX && Math.abs(centreY(f.dashes) - centreY(f.time)) <= BAND_PX;
}

export function isEveryFileTextRight(f: ExpandFacts): boolean {
  let isRight = f.buttons.length > 0;
  for (const button of f.buttons) {
    isRight &&= FILE_LINE_PATTERN.test(button.text);
  }
  return isRight;
}

// The tool kind has no dash color, so its lines use the ink color.
export function isEveryFileColourRight(f: ExpandFacts): boolean {
  let isRight = f.buttons.length > 0;
  for (const button of f.buttons) {
    const kind = button.kind.slice(FILE_KIND_PREFIX.length);
    const expected = kind === "tool" ? f.ink : f.dashColors[kind];
    isRight &&= button.kind.startsWith(FILE_KIND_PREFIX) && button.color === expected;
  }
  return isRight;
}

// One pixel of slack: the stage moves by the rounded list height, the box reads a fraction.
export const isNextRowMovedDown = (f: ExpandFacts) => f.nextAfter - f.nextBefore >= f.listHeight - LEVEL_PX;
export const isRowClosed = (f: ClosedFacts) => f.expanded === 0 && f.tickFiles === 0;
// The jump lights the landed node and its owning bubble, so two found, one of them a filebox.
export const isSingleClickRight = (f: SingleFacts) => f.tickFiles === 0 && f.found === 2 && f.foundBoxes === 1;
export const isQuiet = (f: QuietFacts) => f.errors === 0 && f.isIdle;

// Reads one expression, judges the facts and prints the facts when the judge fails.
export async function reportFacts<T>(page: HeadlessPage, expression: string, title: string, isRight: (facts: T) => boolean): Promise<T> {
  const facts = await page.evaluate<T>(expression);
  reportCheck(title, isRight(facts), facts);
  return facts;
}

export async function shootRulerState(page: HeadlessPage, name: string): Promise<void> {
  await reportFacts(page, QUIET_FACTS, `RULER ${name}: no console error and the load bar is idle`, isQuiet);
  await saveScreenshot(page, name);
  console.log(`RULER screenshot: scripts/visual/out/mockup-${name}.png`);
}

async function validateDefaultRows(page: HeadlessPage): Promise<void> {
  const text = await page.evaluate<TickTextFacts>(TICK_TEXT_FACTS);
  reportCheck("RULER default: each row reads mm-dd-yyyy:hh:mm (N) and its title is the full time with milliseconds", isRowTextRight(text), text.ticks.slice(0, 3));
  reportCheck(`RULER default: one row per leader (${FIXTURE_TICK_COUNT}) and no two rows share a full time`, isRowCountRight(text), [text.ticks.length, text.leaders]);
  const dashes = await page.evaluate<DashFacts[]>(DASH_FACTS);
  reportCheck("RULER default: the dashes sit below the time inside its width, and the time sits on its axis line", isEveryDashBelowTime(dashes), dashes.slice(0, 3));
  await reportFacts(page, LAYOUT_FACTS, "RULER default: the ruler is 152px, the stage follows it, and the gap equals the slack rule", isLayoutRight);
}

export async function validateDefaultState(page: HeadlessPage): Promise<void> {
  await reportFacts(page, HEAD_FACTS, "RULER default: the head is the first child of the ruler with one session button, no jfred button, no session or commit column", isHeadRight);
  await reportFacts(page, COLOUR_FACTS, "RULER default: no row is coloured while the session button is off", isRowsPlain);
  await reportFacts(page, HEAD_SCROLL_FACTS, "RULER default: the head is 44px tall with a dotted bottom and stays fixed while the ticks scroll", isHeadFixed);
  await validateDefaultRows(page);
  await shootRulerState(page, RULER_UI_SCREENSHOTS.default);
}

async function validateExpandedRow(page: HeadlessPage): Promise<void> {
  const open = await page.evaluate<ExpandFacts>(EXPAND_CLICK);
  reportCheck("RULER expanded: the row opens, (N) hides, the dashes sit right of the time, one file line per event", isExpandedRight(open), open);
  reportCheck("RULER expanded: each file line reads <name>  <hash8> or <name>  @vN 📸", isEveryFileTextRight(open), open.buttons);
  reportCheck("RULER expanded: each file line has the color of its kind's dash, and tool lines use the ink color", isEveryFileColourRight(open), open);
  reportCheck("RULER expanded: the next row moves down by at least the file list height", isNextRowMovedDown(open), open);
  await page.evaluate(SCROLL_EXPANDED);
  await shootRulerState(page, RULER_UI_SCREENSHOTS.expanded);
}

export async function validateExpandedState(page: HeadlessPage): Promise<void> {
  await validateExpandedRow(page);
  await reportFacts(page, ESCAPE_CLOSE, "RULER expanded: Escape closes the row and its file list", isRowClosed);
  await reportFacts(page, SINGLE_CLICK, "RULER expanded: a row with one event opens no list and marks its node and bubble as found", isSingleClickRight);
}

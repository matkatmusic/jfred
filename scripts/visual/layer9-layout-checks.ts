// Layer 9 layout checks: the strip beside the session column, pinned on scroll, and free of overlaps.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { isNear } from "./layer7-facts.ts";
import { listColourLiteralRules } from "./layer7-ignored-checks.ts";
import { SCROLL_HOME, buildScrollTo } from "./layer7-probes.ts";
import { CUT_RULE_TEXTS, ENTRY_FACTS, OVERLAP_FACTS, SLACK_FACTS, STRIP_LAYOUT_FACTS, type EntryFacts, type PageBox } from "./layer9-probes.ts";

export interface StripLayoutFacts {
  stripLeft: number; stripRight: number; trackLeft: number; trackRight: number; rulerRight: number; paneLeft: number; position: string; firstBoxLeft: number;
}
export interface SlackFacts { stripRules: number; marginWith: string; marginWithout: string }
export interface OverlapFacts {
  strip: PageBox; track: PageBox; labels: PageBox[]; button: PageBox & { isClipped: boolean }; lines: (PageBox & { nodeCx: number })[];
}

const EDGE_TOLERANCE_PX = 0.5;
const LEVEL_TOLERANCE_PX = 1;
const SCROLL_RIGHT_PX = 400;
const SCROLL_DOWN_PX = 600;
const MAX_LINE_HEIGHT_PX = 2;

export function isStripBesideColumn(facts: StripLayoutFacts): boolean {
  const isTouchingColumn = isNear(facts.stripLeft, facts.trackRight, EDGE_TOLERANCE_PX);
  const isColumnTouchingRuler = isNear(facts.rulerRight, facts.trackLeft, EDGE_TOLERANCE_PX);
  return isTouchingColumn && isColumnTouchingRuler && facts.position === "sticky";
}

export function isStripPinned(home: StripLayoutFacts, scrolled: StripLayoutFacts, scrollLeft: number): boolean {
  const isSameOffset = isNear(scrolled.stripLeft - scrolled.paneLeft, home.stripLeft - home.paneLeft, EDGE_TOLERANCE_PX);
  return scrollLeft > 0 && isSameOffset && scrolled.firstBoxLeft < scrolled.stripRight;
}

export function isEntryLevelWithTick(entries: EntryFacts[]): boolean {
  let isLevel = entries.length > 0;
  for (const entry of entries)
    isLevel &&= isNear(entry.cy, entry.tickCy, LEVEL_TOLERANCE_PX);
  return isLevel;
}

function isMovedBy(before: EntryFacts[], after: EntryFacts[], distancePx: number): boolean {
  return before.length > 0 && before.length === after.length && isNear(before[0]!.cy - after[0]!.cy, distancePx, LEVEL_TOLERANCE_PX);
}

export const isIntersecting = (a: PageBox, b: PageBox) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const isInside = (inner: PageBox, outer: PageBox) => inner.left >= outer.left && inner.right <= outer.right;

export function isLabelClear(facts: OverlapFacts): boolean {
  let isClear = facts.labels.length > 0;
  for (const [at, label] of facts.labels.entries()) {
    isClear &&= label.left >= facts.track.right;
    for (const other of facts.labels.slice(at + 1))
      isClear &&= !isIntersecting(label, other);
  }
  return isClear;
}

export function isStripContentInside(facts: OverlapFacts): boolean {
  let isIn = isInside(facts.button, facts.strip) && !facts.button.isClipped;
  for (const label of facts.labels)
    isIn &&= isInside(label, facts.strip);
  return isIn;
}

export function isLineRight(facts: OverlapFacts): boolean {
  let isRight = facts.lines.length > 0;
  for (const line of facts.lines) {
    const isThin = line.bottom - line.top <= MAX_LINE_HEIGHT_PX;
    isRight &&= isThin && line.left <= facts.track.left + EDGE_TOLERANCE_PX && isNear(line.right, line.nodeCx, LEVEL_TOLERANCE_PX);
  }
  return isRight;
}

async function validateBesideColumn(page: HeadlessPage): Promise<StripLayoutFacts> {
  await page.evaluate(SCROLL_HOME);
  const home = await page.evaluate<StripLayoutFacts>(STRIP_LAYOUT_FACTS);
  reportCheck("L9 the strip touches the session column, the column touches the ruler, and the strip is sticky", isStripBesideColumn(home), home);
  return home;
}

async function validatePinned(page: HeadlessPage, home: StripLayoutFacts): Promise<void> {
  const scrollLeft = await page.evaluate<number>(buildScrollTo(0, SCROLL_RIGHT_PX));
  const scrolled = await page.evaluate<StripLayoutFacts>(STRIP_LAYOUT_FACTS);
  reportCheck("L9 scrolled right, the strip stays pinned beside the column and the bubbles slide under it", isStripPinned(home, scrolled, scrollLeft), [scrollLeft, scrolled]);
  await page.evaluate(SCROLL_HOME);
}

async function validateLevelOnScroll(page: HeadlessPage): Promise<void> {
  const homeEntries = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  await page.evaluate(buildScrollTo(SCROLL_DOWN_PX, 0));
  const downEntries = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  const isRight = isEntryLevelWithTick(downEntries) && isMovedBy(homeEntries, downEntries, SCROLL_DOWN_PX);
  reportCheck(`L9 scrolled down ${SCROLL_DOWN_PX}px, every strip node still shares a centre line with its ruler tick`, isRight, downEntries);
  await page.evaluate(SCROLL_HOME);
}

export async function validateStripLayout(page: HeadlessPage): Promise<void> {
  await validatePinned(page, await validateBesideColumn(page));
  await validateLevelOnScroll(page);
}

export async function validateTokens(page: HeadlessPage): Promise<void> {
  const ruleTexts = await page.evaluate<string[]>(CUT_RULE_TEXTS);
  const literals = listColourLiteralRules(ruleTexts);
  reportCheck("L9 the strip, mark and message rules hold no colour literal, so dark mode follows the tokens", ruleTexts.length > 0 && literals.length === 0, literals);
}

export async function validateSlack(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<SlackFacts>(SLACK_FACTS);
  reportCheck("L9 one rule for .jfred-strip + .stage, and the stage margin is the same without the strip", facts.stripRules === 1 && facts.marginWith === facts.marginWithout, facts);
}

export async function validateStripOverlaps(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  const facts = await page.evaluate<OverlapFacts>(OVERLAP_FACTS);
  reportCheck("L9 no two strip labels overlap, and no label reaches into the session column", isLabelClear(facts), facts.labels);
  reportCheck("L9 every strip label and the Delete button lie inside the strip, and the button text is not clipped", isStripContentInside(facts), [facts.strip, facts.button]);
  reportCheck("L9 each dashed line is thin, starts at the column's left edge and ends at its node", isLineRight(facts), facts.lines);
}

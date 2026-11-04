// Layer 7 layout checks: column position, ruler alignment, and the slack rule it copies.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { isNear } from "./layer7-facts.ts";
import { SCROLL_HOME, buildScrollTo } from "./layer7-probes.ts";

export interface LayoutFacts {
  rulerRight: number; trackLeft: number; trackRight: number; stageLeft: number; bubbleLeft: number; isTrackOnTop: boolean;
}
export interface RuleFacts { rulerRules: number; trackRules: number; marginWith: string; marginWithout: string }

// The column touches the ruler: no gap where a file box could show.
const RULER_TO_TRACK_PX = 0;
const TOUCH_TOLERANCE_PX = 0.5;
const TRACK_TO_STAGE_PX = 14;
const TOLERANCE_PX = 1;
const SCROLL_RIGHT_PX = 400;

export const LAYOUT_FACTS = `(() => {
    const edge = id => document.getElementById(id).getBoundingClientRect();
    const track = document.getElementById('annotation-track');
    const mark = track.querySelector('i.anode:not(.is-ignored)').getBoundingClientRect();
    const hit = document.elementFromPoint(mark.left + mark.width / 2, mark.top + mark.height / 2);
    return { rulerRight: edge('ruler').right, trackLeft: edge('annotation-track').left, trackRight: edge('annotation-track').right,
        stageLeft: edge('stage').left, bubbleLeft: document.querySelector('.filebox').getBoundingClientRect().left,
        isTrackOnTop: hit !== null && track.contains(hit) };
})()`;

// Takes the column out and puts it back in one step, so the page never draws without it.
export const RULE_FACTS = `(() => {
    const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const count = text => rules.filter(rule => rule.selectorText === text).length;
    const stage = document.getElementById('stage');
    const track = document.getElementById('annotation-track');
    const parent = track.parentNode;
    const next = track.nextSibling;
    const marginWith = getComputedStyle(stage).marginLeft;
    track.remove();
    const marginWithout = getComputedStyle(stage).marginLeft;
    parent.insertBefore(track, next);
    return { rulerRules: count('.ruler + .stage'), trackRules: count('.atrack + .stage'), marginWith, marginWithout };
})()`;

export function isColumnAfterRuler(facts: LayoutFacts): boolean {
  return isNear(facts.trackLeft - facts.rulerRight, RULER_TO_TRACK_PX, TOUCH_TOLERANCE_PX);
}

export function isColumnBetween(facts: LayoutFacts): boolean {
  const isBeforeStage = isNear(facts.stageLeft - facts.trackRight, TRACK_TO_STAGE_PX, TOLERANCE_PX);
  return isColumnAfterRuler(facts) && isBeforeStage;
}

// Scrolled right, the stage slides left under the pinned column.
export function isStageUnderColumn(facts: LayoutFacts): boolean {
  return facts.stageLeft < facts.trackRight;
}

export function isBubbleBesideColumn(facts: LayoutFacts): boolean {
  return facts.bubbleLeft >= facts.trackRight - TOLERANCE_PX;
}

export function isSlackRuleKept(facts: RuleFacts): boolean {
  const isOneEach = facts.rulerRules === 1 && facts.trackRules === 1;
  return isOneEach && facts.marginWith === facts.marginWithout;
}

async function validateBetween(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  const facts = await page.evaluate<LayoutFacts>(LAYOUT_FACTS);
  const isRight = isColumnBetween(facts) && isBubbleBesideColumn(facts);
  reportCheck("L7 the column touches the ruler, sits 14px left of the stage, and the first bubble starts after it", isRight, facts);
}

async function validateBesideRuler(page: HeadlessPage): Promise<void> {
  const scrollLeft = await page.evaluate<number>(buildScrollTo(0, SCROLL_RIGHT_PX));
  const facts = await page.evaluate<LayoutFacts>(LAYOUT_FACTS);
  const isRight = scrollLeft > 0 && isColumnAfterRuler(facts) && isStageUnderColumn(facts) && facts.isTrackOnTop;
  reportCheck("L7 scrolled right, the column still touches the ruler and covers the bubbles", isRight, [scrollLeft, facts]);
  await page.evaluate(SCROLL_HOME);
}

async function validateSlackRule(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<RuleFacts>(RULE_FACTS);
  reportCheck("L7 one rule for .ruler + .stage and one for .atrack + .stage, and the stage margin is the same without the column", isSlackRuleKept(facts), facts);
}

export async function validateLayout(page: HeadlessPage): Promise<void> {
  await validateBetween(page);
  await validateBesideRuler(page);
  await validateSlackRule(page);
}

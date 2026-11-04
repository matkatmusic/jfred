// Layer 7 hide-ignored checks: the show-row box, what its toggle does, and the colour tokens of the new rules.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { COLUMN_RULE_TEXTS, IGNORED_FACTS, SCROLL_HOME, buildHideSettled, buildSetHideIgnored } from "./layer7-probes.ts";

export interface IgnoredFacts {
  text: string; isChecked: boolean; hasAttribute: boolean; ignoredCount: number; ignoredShown: number; otherShown: number;
  opacities: number[]; hiddenKinds: string; kindBoxes: string; requests: number;
}

const WAIT_MS = 10_000;
const HIDE_LABEL = "hide ignored nodes";
const IGNORED_NODE_TOTAL = 2;
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

export function isHideControlRight(facts: IgnoredFacts): boolean {
  const isOn = facts.isChecked && facts.hasAttribute;
  const isHidden = facts.ignoredCount === IGNORED_NODE_TOTAL && facts.ignoredShown === 0;
  return facts.text === HIDE_LABEL && isOn && isHidden;
}

function isEveryOpacityBelowOne(opacities: number[]): boolean {
  let isDim = opacities.length > 0;
  for (const opacity of opacities) {
    const isBelowOne = opacity < 1;
    if (!isBelowOne)
      isDim = false;
  }
  return isDim;
}

export function isIgnoredRevealed(hidden: IgnoredFacts, revealed: IgnoredFacts): boolean {
  const isAllShown = revealed.ignoredShown === IGNORED_NODE_TOTAL && revealed.ignoredCount === hidden.ignoredCount;
  const isBoxOff = !revealed.isChecked && !revealed.hasAttribute;
  const isOthersSame = revealed.otherShown === hidden.otherShown;
  return isAllShown && isBoxOff && isOthersSame && isEveryOpacityBelowOne(revealed.opacities);
}

export function isFilterUntouched(base: IgnoredFacts, other: IgnoredFacts): boolean {
  return base.hiddenKinds === other.hiddenKinds && base.kindBoxes === other.kindBoxes && base.requests === other.requests;
}

export function listColourLiteralRules(ruleTexts: string[]): string[] {
  const literals: string[] = [];
  for (const text of ruleTexts) {
    const hasLiteral = COLOUR_LITERAL.test(text);
    if (hasLiteral)
      literals.push(text);
  }
  return literals;
}

async function setHideIgnored(page: HeadlessPage, isOn: boolean): Promise<IgnoredFacts> {
  await page.evaluate(buildSetHideIgnored(isOn));
  await page.waitFor(buildHideSettled(isOn), WAIT_MS);
  return page.evaluate<IgnoredFacts>(IGNORED_FACTS);
}

export async function validateIgnored(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  const hidden = await page.evaluate<IgnoredFacts>(IGNORED_FACTS);
  reportCheck("L7 hide ignored nodes: exact label, ticked, attribute on, 2 ignored nodes drawn with no box", isHideControlRight(hidden), hidden);
  const revealed = await setHideIgnored(page, false);
  reportCheck("L7 unticking shows both ignored nodes dimmed and leaves the other nodes alone", isIgnoredRevealed(hidden, revealed), revealed);
  await saveScreenshot(page, "16-layer7-ignored-shown");
  console.log("L7 screenshot: scripts/visual/out/mockup-16-layer7-ignored-shown.png");
  const restored = await setHideIgnored(page, true);
  reportCheck("L7 reticking hides the ignored nodes again", isHideControlRight(restored), restored);
  const isQuiet = isFilterUntouched(hidden, revealed) && isFilterUntouched(hidden, restored);
  reportCheck("L7 the toggle leaves hidden kinds, kind boxes and requests as they were", isQuiet, [hidden, revealed, restored]);
}

export async function validateColourTokens(page: HeadlessPage): Promise<void> {
  const ruleTexts = await page.evaluate<string[]>(COLUMN_RULE_TEXTS);
  const literals = listColourLiteralRules(ruleTexts);
  reportCheck("L7 the new rules hold no colour literal, so dark mode follows the tokens", ruleTexts.length > 0 && literals.length === 0, literals);
}

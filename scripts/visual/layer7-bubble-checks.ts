// Layer 7 bubble checks: tool pair in one file bubble, tool box, and the click that opens nothing.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { isBracketSpanning, isNear, type BracketFacts } from "./layer7-facts.ts";
import {
  BUBBLE_PAIR_ID, CLICK_TOOL_NODE, COLUMN_PAIR_ID, DISPATCHER_BUBBLE, HIDDEN_KINDS, BUBBLE_TOOL_FACTS, SCROLL_HOME,
  SCROLL_TO_BUBBLE_PAIR, TOOL_BOX, TOOL_BOX_FACTS, buildBracketProbe,
} from "./layer7-probes.ts";

export interface ToolNodeFacts { cx: number; cy: number; classes: string }
export interface BubbleToolFacts { tnodes: ToolNodeFacts[]; dotX: number; pageToolNodes: number; bubbleColumnNodes: number; pairIds: string[] }
export interface ToolBoxFacts {
  exists: boolean; isChecked: boolean | undefined; label: string | undefined; hiddenKinds: string; otherBoxes: string;
  toolShown: number; columnToolShown: number;
}
export interface ClickFacts { isOpen: boolean; requests: number }

const WAIT_MS = 10_000;
const TOLERANCE_PX = 2;
const RAIL_TOLERANCE_PX = 1;
const TOOL_BOX_LABEL = "tool call";
const COLUMN_PAIR_DOT_COUNT = 2;
const BUBBLE_BRACKET = buildBracketProbe(DISPATCHER_BUBBLE, `.tbracket[data-pair-id="${BUBBLE_PAIR_ID}"]`);

function countToolNodesWithClass(tnodes: ToolNodeFacts[], cssClass: string): number {
  let total = 0;
  for (const node of tnodes) {
    const hasClass = node.classes.split(" ").includes(cssClass);
    if (hasClass)
      total += 1;
  }
  return total;
}

function isEveryNodeOnRail(tnodes: ToolNodeFacts[], dotX: number): boolean {
  let isOnRail = tnodes.length > 0;
  for (const node of tnodes) {
    const isThisOnRail = isNear(node.cx, dotX, RAIL_TOLERANCE_PX);
    if (!isThisOnRail)
      isOnRail = false;
  }
  return isOnRail;
}

export function isBubblePairRight(facts: BubbleToolFacts, bracket: BracketFacts): boolean {
  const [first, second] = facts.tnodes;
  const isPair = facts.tnodes.length === 2 && first !== undefined && second !== undefined;
  const isTyped = countToolNodesWithClass(facts.tnodes, "a-tool-use") === 1 && countToolNodesWithClass(facts.tnodes, "a-tool-result") === 1;
  const isAlone = facts.pageToolNodes === 2 && facts.bubbleColumnNodes === 0;
  const isSpanned = isPair && isBracketSpanning(bracket, Math.min(first.cy, second.cy), Math.max(first.cy, second.cy), TOLERANCE_PX);
  return isPair && isTyped && isAlone && isSpanned && isEveryNodeOnRail(facts.tnodes, facts.dotX);
}

export function isPairIdSetRight(pairIds: string[]): boolean {
  return JSON.stringify([...new Set(pairIds)].sort()) === JSON.stringify([BUBBLE_PAIR_ID, COLUMN_PAIR_ID].sort());
}

function isToolHidden(facts: ToolBoxFacts): boolean {
  return facts.hiddenKinds.split(" ").includes("tool");
}

export function isToolBoxRight(facts: ToolBoxFacts): boolean {
  const isBoxRight = facts.exists && facts.isChecked === true && facts.label === TOOL_BOX_LABEL;
  // return isBoxRight && !isToolHidden(facts) && facts.toolShown > 0 && facts.columnToolShown === 1;
  return isBoxRight && !isToolHidden(facts) && facts.toolShown > 0 && facts.columnToolShown === COLUMN_PAIR_DOT_COUNT;
}

export function isToolBoxOff(before: ToolBoxFacts, off: ToolBoxFacts): boolean {
  const isGone = off.toolShown === 0 && off.isChecked === false && isToolHidden(off);
  return isGone && off.columnToolShown === before.columnToolShown && off.otherBoxes === before.otherBoxes;
}

export function isToolBoxRestored(before: ToolBoxFacts, on: ToolBoxFacts): boolean {
  const isBack = on.toolShown === before.toolShown && on.isChecked === true && !isToolHidden(on);
  return isBack && on.columnToolShown === before.columnToolShown && on.otherBoxes === before.otherBoxes;
}

async function clickToolBox(page: HeadlessPage, isHiddenWanted: boolean): Promise<ToolBoxFacts> {
  await page.evaluate(`${TOOL_BOX}.click()`);
  await page.waitFor(`${HIDDEN_KINDS}.split(' ').includes('tool') === ${isHiddenWanted}`, WAIT_MS);
  return page.evaluate<ToolBoxFacts>(TOOL_BOX_FACTS);
}

async function validateToolBox(page: HeadlessPage): Promise<void> {
  const before = await page.evaluate<ToolBoxFacts>(TOOL_BOX_FACTS);
  reportCheck("L7 the Show row ends with a ticked tool call box that shows its nodes and the column pair", isToolBoxRight(before), before);
  const off = await clickToolBox(page, true);
  reportCheck("L7 unticking tool call hides the bubble tool parts, keeps the column pair and the other boxes", isToolBoxOff(before, off), off);
  const on = await clickToolBox(page, false);
  reportCheck("L7 reticking tool call restores everything", isToolBoxRestored(before, on), on);
}

async function validateBubblePair(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<BubbleToolFacts>(BUBBLE_TOOL_FACTS);
  const bracket = await page.evaluate<BracketFacts>(BUBBLE_BRACKET);
  reportCheck("L7 the dispatcher bubble holds the tool pair on its lane rail with a dashed bracket, and no other bubble does", isBubblePairRight(facts, bracket), [facts, bracket]);
  reportCheck("L7 two pairs in all: one column bracket and one bubble bracket", isPairIdSetRight(facts.pairIds), facts.pairIds);
}

async function validateClick(page: HeadlessPage): Promise<void> {
  const click = await page.evaluate<ClickFacts>(CLICK_TOOL_NODE);
  reportCheck("L7 a click on a tool node opens no drawer and sends no request", !click.isOpen && click.requests === 0, click);
}

export async function validateBubble(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await validateBubblePair(page);
  // The click runs first: ticking the tool box saves settings, and those requests land late.
  await validateClick(page);
  await validateToolBox(page);
  await page.evaluate(SCROLL_TO_BUBBLE_PAIR);
  await saveScreenshot(page, "17-layer7-bubble-pair");
  console.log("L7 screenshot: scripts/visual/out/mockup-17-layer7-bubble-pair.png");
  await page.evaluate(SCROLL_HOME);
}

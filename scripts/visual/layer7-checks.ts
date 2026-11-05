// Layer 7 checks on the fixture-mode page; mockup.ts calls validateLayer7 and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { validateBubble } from "./layer7-bubble-checks.ts";
import { validateColourTokens, validateIgnored } from "./layer7-ignored-checks.ts";
import { validateLayout } from "./layer7-layout-checks.ts";
import { HIDDEN_KINDS, SCROLL_HOME, openSessionColumn } from "./layer7-probes.ts";
import { validateColumnNodes, validateTrack } from "./layer7-track-checks.ts";

export interface RangeFacts { left: number; right: number; trackLeft: number; nodeLeft: number; isHit: boolean }
export interface MinimapFacts { scaleX: number; viewWidth: number }
export interface RewindFacts { bnodeCount: number; opacity: number; elbowStyle: string; rewindCount: number }

const WAIT_MS = 15_000;
const BRANCH_BOX = `document.querySelector('#show-row input[data-kind="branch"]')`;
const RANGE_FACTS = `(async () => {
    const bar = document.querySelector('.range');
    bar.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise(resolve => setTimeout(resolve, 150));
    const box = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const drawn = [...document.querySelectorAll('#annotation-track i.anode')].filter(n => n.getClientRects().length > 0);
    return { left: box.left, right: box.right, trackLeft: document.getElementById('annotation-track').getBoundingClientRect().left,
        nodeLeft: Math.min(...drawn.map(n => n.getBoundingClientRect().left)), isHit: hit === bar };
})()`;
const MINIMAP_FACTS = `({ scaleX: Number(document.getElementById('mm-plot').dataset.scaleX),
    viewWidth: document.getElementById('mm-view').getBoundingClientRect().width })`;
const REWIND_FACTS = `({ bnodeCount: document.querySelectorAll('.bnode').length,
    opacity: Number(getComputedStyle(document.querySelector('.bnode')).opacity),
    elbowStyle: getComputedStyle(document.querySelector('.split-elbow')).borderTopStyle,
    rewindCount: document.querySelectorAll('[class*="rewind"], [data-record-kind*="rewind"], [data-kind="rewind"]').length })`;

// The bar sits inside the column, left of its first node, and is the top element at its centre.
export function isRangeClear(facts: RangeFacts): boolean {
  return facts.left >= facts.trackLeft && facts.right <= facts.nodeLeft && facts.isHit;
}

export function isMinimapLive(facts: MinimapFacts): boolean {
  return facts.scaleX > 0 && facts.viewWidth > 0;
}

export function isRewindDrawnByLayer5Only(facts: RewindFacts): boolean {
  const isDimmed = facts.bnodeCount > 0 && facts.opacity < 1 && facts.elbowStyle === "dashed";
  return isDimmed && facts.rewindCount === 0;
}

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

async function validateSessionBars(page: HeadlessPage): Promise<void> {
  await page.evaluate(`document.querySelector('.session-item').click()`);
  await page.waitFor(`document.querySelectorAll('.range').length > 0 && ${STRIP_IDLE}`, WAIT_MS);
  const facts = await page.evaluate<RangeFacts>(RANGE_FACTS);
  reportCheck("L7 a session bar is on top of the column, inside its left part, left of the first node", isRangeClear(facts), facts);
  await page.evaluate(`document.getElementById('clear-sessions').click()`);
  await page.waitFor(`document.querySelectorAll('.range').length === 0 && ${STRIP_IDLE}`, WAIT_MS);
  await page.evaluate(SCROLL_HOME);
}

async function validateMinimap(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<MinimapFacts>(MINIMAP_FACTS);
  reportCheck("L7 the minimap still has a scale and a view box", isMinimapLive(facts), facts);
}

async function validateRewind(page: HeadlessPage): Promise<void> {
  await page.evaluate(`${BRANCH_BOX}.click()`);
  await page.waitFor(`document.querySelectorAll('.blane').length > 0 && ${STRIP_IDLE}`, WAIT_MS);
  const facts = await page.evaluate<RewindFacts>(REWIND_FACTS);
  reportCheck("L7 the rewound lane is the Layer 5 look (dimmed dots, dashed elbows) and L7 draws no rewind node", isRewindDrawnByLayer5Only(facts), facts);
  await page.evaluate(`${BRANCH_BOX}.click()`);
  await page.waitFor(`${HIDDEN_KINDS}.includes('branch')`, WAIT_MS);
}

export async function validateLayer7(page: HeadlessPage, pageUrl: string): Promise<void> {
  await waitForFreshPage(page, pageUrl);
  await openSessionColumn(page);
  await validateTrack(page);
  await validateColumnNodes(page);
  await validateIgnored(page);
  await validateColourTokens(page);
  await validateBubble(page);
  await validateLayout(page);
  await validateSessionBars(page);
  await validateMinimap(page);
  await validateRewind(page);
  await waitForFreshPage(page, pageUrl);
}

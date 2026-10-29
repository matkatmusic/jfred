// Task 357: ticks the Branch box on the real server and checks the page against the real /api/layer1-branches payload.

import { type WireBranchesView } from "../../webapp/layer1-wire-branches.ts";
import { type HeadlessPage } from "./cdp.ts";
import { validateLaneNodeClicks } from "./layer5-lane-click.ts";
import { JOT_MERGE_PATH, listDrawnLanes, PAGE_PROBE, type DrawnLane, type PageFacts } from "./layer5-real-facts.ts";
import { validateLanes } from "./layer5-real-lane-checks.ts";
import { validateNamedMerge, validateTrunkRails } from "./layer5-real-trunk-checks.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const JOT_LANE_NODE_COUNT = 6;
const JOT_LANE_FROM = "2026-05-01T19:11:00Z";
const JOT_LANE_TO = "2026-05-01T19:17:00Z";
const FINDING_LABEL = /finding branches.*\d+ \/ \d+/;
const RECONSTRUCTING_LABEL = /reconstructing branches.*\d+ \/ \d+/;
const BRANCH_BOX = `document.querySelector('#show-row input[data-kind="branch"]')`;
const COUNT_LANES = `document.querySelectorAll('.blane').length`;
const COUNT_REQUESTS = `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-branches')).length`;
const SHIELD_HIDDEN = `document.getElementById('busy-shield').hidden`;

// Installed before the tick: records the shield, the loadbar strip and the counter labels.
const WATCH_BUSY = `(() => {
    window.__busy = { shieldShown: false, stripShown: false, labels: [] };
    const shield = document.getElementById('busy-shield');
    new MutationObserver(() => { if (!shield.hidden) window.__busy.shieldShown = true; })
        .observe(shield, { attributes: true, attributeFilter: ['hidden'] });
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__busy.stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
    const label = document.getElementById('busy-label');
    new MutationObserver(() => window.__busy.labels.push(label.textContent))
        .observe(label, { childList: true, characterData: true, subtree: true });
})()`;

function findLabelIndex(labels: string[], pattern: RegExp): number {
  for (let index = 0; index < labels.length; index++) {
    const isMatch = pattern.test(labels[index]!);
    if (isMatch) {
      return index;
    }
  }
  return -1;
}

export async function validateBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("l5-real before the box: no .blane is drawn", await page.evaluate<number>(COUNT_LANES) === 0);
  reportCheck("l5-real before the box: no /api/layer1-branches request yet", await page.evaluate<number>(COUNT_REQUESTS) === 0);
}

export async function validateFirstFetch(page: HeadlessPage, payload: WireBranchesView, fetchTimeoutMs: number): Promise<void> {
  await page.evaluate(WATCH_BUSY);
  await page.evaluate(`${BRANCH_BOX}.click()`);
  await page.waitFor(`${COUNT_LANES} > 0 && ${SHIELD_HIDDEN} && !document.querySelector('.viz-root').dataset.hiddenKinds.includes('branch')`, fetchTimeoutMs);
  const busy = await page.evaluate<{ shieldShown: boolean; stripShown: boolean; labels: string[] }>(`window.__busy`);
  const findingAt = findLabelIndex(busy.labels, FINDING_LABEL);
  const reconstructingAt = findLabelIndex(busy.labels, RECONSTRUCTING_LABEL);
  reportCheck("l5-real the blocking shield shows during the fetch", busy.shieldShown);
  reportCheck("l5-real the loadbar strip shows during the fetch", busy.stripShown);
  reportCheck("l5-real the labels read finding branches, then reconstructing branches, as n / m",
    findingAt >= 0 && reconstructingAt > findingAt, busy.labels.slice(-4));
  reportCheck("l5-real the shield is hidden once the payload lands", await page.evaluate<boolean>(SHIELD_HIDDEN));
  reportCheck("l5-real exactly one /api/layer1-branches request", await page.evaluate<number>(COUNT_REQUESTS) === 1);
  const drawn = await page.evaluate<number>(COUNT_LANES);
  const viewPaths = new Set(await page.evaluate<string[]>(`[...document.querySelectorAll('.fname[data-path]')].map(n => n.dataset.path)`));
  let expectedLanes = 0;
  let payloadLanes = 0;
  for (const pair of payload.pairs) {
    payloadLanes += pair.branches.length;
    const isPairDrawn = viewPaths.has(pair.path);
    if (isPairDrawn) {
      expectedLanes += pair.branches.length;
    }
  }
  reportCheck("l5-real the .blane count equals the payload lane count on drawn pairs", drawn === expectedLanes && drawn > 0, { drawn, expectedLanes });
  console.log(`lanes: payload ${payloadLanes}, drawn ${drawn}`);
}

export async function validateToggle(page: HeadlessPage): Promise<void> {
  const counts = await page.evaluate<{ off: number; on: number }>(`(() => {
        const box = ${BRANCH_BOX};
        const visible = () => [...document.querySelectorAll('.blane')].filter(l => getComputedStyle(l).display !== 'none').length;
        box.click();
        const off = visible();
        box.click();
        return { off, on: visible() };
    })()`);
  reportCheck("l5-real untick hides every lane, re-tick shows them again", counts.off === 0 && counts.on > 0, counts);
  reportCheck("l5-real toggling adds no request", await page.evaluate<number>(COUNT_REQUESTS) === 1);
}

// Jot: all six nodes of the named lane (session 9bbf7538); other data: the first two lane nodes.
async function validateRealLaneClicks(page: HeadlessPage, isJot: boolean): Promise<void> {
  await validateLaneNodeClicks(page, "l5-real", isJot
    ? { path: JOT_MERGE_PATH, max: JOT_LANE_NODE_COUNT, instantWindow: [JOT_LANE_FROM, JOT_LANE_TO] }
    : { max: 2 });
}

function printDrawnLanes(lanes: DrawnLane[]): void {
  for (const lane of lanes) {
    const merge = lane.facts.mergeBottom === null ? "no merge" : lane.payload.keptToEnd === true ? "merge keptToEnd" : "merge rejoinAt";
    console.log(`lane ${lane.path} fork ${lane.payload.forkAt} ${lane.payload.rewindKind} ${merge}`);
  }
}

export async function executeLayer5RealChecks(
  page: HeadlessPage, payload: WireBranchesView, fetchTimeoutMs: number, screenshotName: string, isJot: boolean, isReveng: boolean,
): Promise<void> {
  await validateBeforeTick(page);
  await validateFirstFetch(page, payload, fetchTimeoutMs);
  const facts = await page.evaluate<PageFacts>(PAGE_PROBE);
  const lanes = listDrawnLanes(payload, facts);
  printDrawnLanes(lanes);
  validateLanes(lanes, facts);
  validateTrunkRails(facts);
  validateNamedMerge(lanes, isJot, isReveng);
  await validateToggle(page);
  await validateRealLaneClicks(page, isJot);
  await page.evaluate(`document.querySelector('.blane .split-elbow').scrollIntoView({ block: 'start', inline: 'nearest' })`);
  await saveScreenshot(page, screenshotName);
}

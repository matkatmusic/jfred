// Task 357: ticks the Branch box on the real server and checks the page against the real /api/layer1-branches payload.

import { WireRewindKind, type WireBranchesView } from "../../webapp/layer1-wire.ts";
import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const JOT_MERGE_PATH = "common/scripts/plate/spawn_summary_agent.py";
const REVENG_MERGE_PATH = "jfred/tests/reconstruction_bound.test.ts";
const TOLERANCE_PX = 1;
const BNODE_OPACITY = 0.38;
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

interface LaneFacts {
  splitTop: number; splitStyle: string; railStyle: string; railOpacity: number;
  mergeBottom: number | null; bnodeOpacities: number[]; bnodeMaxCy: number;
}
interface BubbleFacts {
  path: string; trunkRailLeft: number; trunkRailStyle: string;
  trunk: { instant: string; opacity: number; cy: number }[]; lanes: LaneFacts[];
}
interface PageFacts { ticks: { text: string; cy: number }[]; plainRailLeft: number | null; bubbles: BubbleFacts[] }

const PAGE_PROBE = `(() => {
    const rect = (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, cy: r.top + r.height / 2 }; };
    const style = (e) => getComputedStyle(e);
    const isShown = (e) => style(e).display !== 'none' && style(e).visibility !== 'hidden';
    const boxes = [...document.querySelectorAll('.filebox')].filter(b => b.querySelector('.fname[data-path]'));
    const railLeft = (b) => rect(b.querySelector('.lrail')).left - rect(b).left;
    const plain = boxes.find(b => !b.querySelector('.blane'));
    return {
        ticks: [...document.querySelectorAll('.ruler .tick')].map(t => ({ text: t.textContent, cy: rect(t).cy })),
        plainRailLeft: plain ? railLeft(plain) : null,
        bubbles: boxes.filter(b => b.querySelector('.blane')).map(b => ({
            path: b.querySelector('.fname[data-path]').dataset.path,
            trunkRailLeft: railLeft(b),
            trunkRailStyle: style(b.querySelector('.lrail')).borderLeftStyle,
            trunk: [...b.querySelectorAll('.lane > .node')].filter(isShown)
                .map(n => ({ instant: n.dataset.instant, opacity: parseFloat(style(n).opacity), cy: rect(n).cy })),
            lanes: [...b.querySelectorAll('.blane')].map(lane => {
                const merge = lane.querySelector('.merge-elbow');
                const bnodes = [...lane.querySelectorAll('.bnode')];
                return {
                    splitTop: rect(lane.querySelector('.split-elbow')).top,
                    splitStyle: style(lane.querySelector('.split-elbow')).borderTopStyle,
                    railStyle: style(lane.querySelector('.brail')).borderLeftStyle,
                    railOpacity: parseFloat(style(lane.querySelector('.brail')).opacity),
                    mergeBottom: merge ? rect(merge).bottom : null,
                    bnodeOpacities: bnodes.map(n => parseFloat(style(n).opacity)),
                    bnodeMaxCy: Math.max(...bnodes.map(n => rect(n).cy)) };
            }) })) };
})()`;

const toTickStamp = (instant: string) => new Date(instant).toISOString().slice(5, 23).replace("T", " ");
const isNear = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) <= TOLERANCE_PX;
const findTickCy = (facts: PageFacts, instant: string) => facts.ticks.find((tick) => tick.text.startsWith(toTickStamp(instant)))?.cy;

type PayloadLane = WireBranchesView["pairs"][number]["branches"][number];
interface DrawnLane { path: string; payload: PayloadLane; facts: LaneFacts; bubble: BubbleFacts }

function listDrawnLanes(payload: WireBranchesView, page: PageFacts): DrawnLane[] {
  return page.bubbles.flatMap((bubble) => {
    const branches = payload.pairs.find((pair) => pair.path === bubble.path)?.branches ?? [];
    return bubble.lanes.map((facts, index) => ({ path: bubble.path, payload: branches[index]!, facts, bubble }));
  });
}

function hasMergeTarget(payload: PayloadLane): boolean {
  return payload.rejoinAt !== undefined || payload.keptToEnd === true;
}

function findRejoinCy(lane: DrawnLane, page: PageFacts): number | undefined {
  const instantMs = Date.parse(lane.payload.rejoinAt!);
  const trunkCys = lane.bubble.trunk.filter((node) => Date.parse(node.instant) === instantMs).map((node) => node.cy);
  return trunkCys.find((cy) => isNear(cy, lane.facts.mergeBottom!)) ?? trunkCys[0] ?? findTickCy(page, lane.payload.rejoinAt!);
}

async function checkBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("l5-real before the box: no .blane is drawn", await page.evaluate<number>(COUNT_LANES) === 0);
  reportCheck("l5-real before the box: no /api/layer1-branches request yet", await page.evaluate<number>(COUNT_REQUESTS) === 0);
}

async function checkFirstFetch(page: HeadlessPage, payload: WireBranchesView, fetchTimeoutMs: number): Promise<void> {
  await page.evaluate(WATCH_BUSY);
  await page.evaluate(`${BRANCH_BOX}.click()`);
  await page.waitFor(`${COUNT_LANES} > 0 && ${SHIELD_HIDDEN} && !document.querySelector('.viz-root').dataset.hiddenKinds.includes('branch')`, fetchTimeoutMs);
  const busy = await page.evaluate<{ shieldShown: boolean; stripShown: boolean; labels: string[] }>(`window.__busy`);
  const findingAt = busy.labels.findIndex((text) => /finding branches.*\d+ \/ \d+/.test(text));
  const reconstructingAt = busy.labels.findIndex((text) => /reconstructing branches.*\d+ \/ \d+/.test(text));
  reportCheck("l5-real the blocking shield shows during the fetch", busy.shieldShown);
  reportCheck("l5-real the loadbar strip shows during the fetch", busy.stripShown);
  reportCheck("l5-real the labels read finding branches, then reconstructing branches, as n / m",
    findingAt >= 0 && reconstructingAt > findingAt, busy.labels.slice(-4));
  reportCheck("l5-real the shield is hidden once the payload lands", await page.evaluate<boolean>(SHIELD_HIDDEN));
  reportCheck("l5-real exactly one /api/layer1-branches request", await page.evaluate<number>(COUNT_REQUESTS) === 1);
  const drawn = await page.evaluate<number>(COUNT_LANES);
  const viewPaths = new Set(await page.evaluate<string[]>(`[...document.querySelectorAll('.fname[data-path]')].map(n => n.dataset.path)`));
  const expectedLanes = payload.pairs.filter((pair) => viewPaths.has(pair.path)).flatMap((pair) => pair.branches).length;
  reportCheck("l5-real the .blane count equals the payload lane count on drawn pairs", drawn === expectedLanes && drawn > 0, { drawn, expectedLanes });
  console.log(`lanes: payload ${payload.pairs.flatMap((pair) => pair.branches).length}, drawn ${drawn}`);
}

function checkLanes(lanes: DrawnLane[], page: PageFacts): void {
  const badSplit = lanes.filter((lane) => !isNear(lane.facts.splitTop, findTickCy(page, lane.payload.forkAt)) || lane.facts.splitStyle !== "dashed");
  reportCheck("l5-real every split elbow is dashed and level with the ruler tick of its forkAt", badSplit.length === 0,
    badSplit.slice(0, 3).map((lane) => [lane.path, lane.payload.forkAt, lane.facts.splitTop, findTickCy(page, lane.payload.forkAt)]));
  const badMergePresence = lanes.filter((lane) => (lane.facts.mergeBottom !== null) !== hasMergeTarget(lane.payload));
  reportCheck("l5-real a merge elbow is drawn exactly when the lane has rejoinAt or keptToEnd", badMergePresence.length === 0,
    badMergePresence.slice(0, 3).map((lane) => [lane.path, lane.payload.rewindKind, lane.payload.rejoinAt, lane.payload.keptToEnd]));
  const badRejoin = lanes.filter((lane) => lane.payload.rejoinAt !== undefined && !isNear(lane.facts.mergeBottom ?? undefined, findRejoinCy(lane, page)));
  reportCheck("l5-real every merge elbow with rejoinAt ends level with that trunk node", badRejoin.length === 0,
    badRejoin.slice(0, 3).map((lane) => [lane.path, lane.payload.rejoinAt, lane.facts.mergeBottom, findRejoinCy(lane, page)]));
  const badKept = lanes.filter((lane) => lane.payload.keptToEnd === true && !isNear(lane.facts.mergeBottom ?? undefined,
    Math.max(...lane.bubble.trunk.map((node) => node.cy), lane.facts.bnodeMaxCy)));
  reportCheck("l5-real every keptToEnd merge elbow ends level with the lowest dot of its bubble", badKept.length === 0,
    badKept.slice(0, 3).map((lane) => [lane.path, lane.facts.mergeBottom]));
  const badRail = lanes.filter((lane) => lane.facts.railStyle !== "dashed" || lane.facts.railOpacity >= 1);
  reportCheck("l5-real every branch rail is dashed and dimmer than 1", badRail.length === 0, badRail.slice(0, 3));
  const opacities = lanes.flatMap((lane) => lane.facts.bnodeOpacities);
  reportCheck("l5-real every branch dot has opacity about .38", opacities.length > 0 && opacities.every((value) => isNear(value, BNODE_OPACITY)), opacities.slice(0, 5));
  const trunkOpacities = lanes.flatMap((lane) => lane.bubble.trunk.map((node) => node.opacity));
  reportCheck("l5-real every visible trunk node in those bubbles has opacity 1", trunkOpacities.length > 0 && trunkOpacities.every((value) => value === 1), trunkOpacities.slice(0, 5));
}

function checkTrunkRails(page: PageFacts): void {
  reportCheck("l5-real every trunk rail in a lane bubble is solid", page.bubbles.every((bubble) => bubble.trunkRailStyle === "solid"));
  if (page.plainRailLeft === null) {
    console.log("SKIP  l5-real every pair on the page has lanes, so no branch-less bubble to compare the trunk rail x with");
    return;
  }
  reportCheck("l5-real the trunk rail sits at the same x as in a branch-less bubble",
    page.bubbles.every((bubble) => isNear(bubble.trunkRailLeft, page.plainRailLeft!)), { plain: page.plainRailLeft, bubbles: page.bubbles.slice(0, 3).map((bubble) => bubble.trunkRailLeft) });
}

function checkNamedMerge(lanes: DrawnLane[], isJot: boolean, isReveng: boolean): void {
  const namedPath = isJot ? JOT_MERGE_PATH : isReveng ? REVENG_MERGE_PATH : undefined;
  const named = lanes.filter((lane) => lane.path === namedPath);
  if (named.length > 0) {
    reportCheck(`l5-real ${namedPath} has a lane with a merge elbow`, named.some((lane) => lane.facts.mergeBottom !== null), named.map((lane) => lane.payload.rewindKind));
    return;
  }
  console.log(`l5-real ${namedPath ?? "demo"} is not drawn, so check 7 derives from the payload`);
  const rejoining = lanes.filter((lane) => lane.payload.rejoinAt !== undefined);
  const codeLanes = lanes.filter((lane) => lane.payload.rewindKind === WireRewindKind.code);
  reportCheck("l5-real every drawn lane with rejoinAt shows a merge elbow", rejoining.every((lane) => lane.facts.mergeBottom !== null), rejoining.length);
  reportCheck("l5-real no drawn code lane shows a merge elbow", codeLanes.every((lane) => lane.facts.mergeBottom === null), codeLanes.length);
}

async function checkToggle(page: HeadlessPage): Promise<void> {
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

function printDrawnLanes(lanes: DrawnLane[]): void {
  for (const lane of lanes) {
    const merge = lane.facts.mergeBottom === null ? "no merge" : lane.payload.keptToEnd === true ? "merge keptToEnd" : "merge rejoinAt";
    console.log(`lane ${lane.path} fork ${lane.payload.forkAt} ${lane.payload.rewindKind} ${merge}`);
  }
}

export async function executeLayer5RealChecks(
  page: HeadlessPage, payload: WireBranchesView, fetchTimeoutMs: number, screenshotName: string, isJot: boolean, isReveng: boolean,
): Promise<void> {
  await checkBeforeTick(page);
  await checkFirstFetch(page, payload, fetchTimeoutMs);
  const facts = await page.evaluate<PageFacts>(PAGE_PROBE);
  const lanes = listDrawnLanes(payload, facts);
  printDrawnLanes(lanes);
  checkLanes(lanes, facts);
  checkTrunkRails(facts);
  checkNamedMerge(lanes, isJot, isReveng);
  await checkToggle(page);
  await page.evaluate(`document.querySelector('.blane .split-elbow').scrollIntoView({ block: 'start', inline: 'nearest' })`);
  await saveScreenshot(page, screenshotName);
}

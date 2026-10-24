// Layer 5 (forked branch lanes) checks on the fixture-mode page; mockup.ts calls checkLayer5.

import { type HeadlessPage } from "./cdp.ts";
import { checkLaneNodeClicks } from "./layer5-lane-click.ts";
import { bubbleOf, reportCheck, saveScreenshot } from "./mockup-checks.ts";

const UTIL_PATH = "src/util.ts";
const INDEX_PATH = "src/index.ts";
const TOLERANCE_PX = 1;
const BNODE_OPACITY = 0.38;
// Fork and rejoin instants of the canned lanes, in lane order (src/viewer_api_layer5_mockup_branches.ts): a fork owns a tick, a rejoin is a trunk commit.
const BRANCH_BOX = `document.querySelector('#show-row input[data-kind="branch"]')`;
const UTIL_FORKS = ["2026-06-01T14:31:00Z"];
const INDEX_FORKS = ["2026-06-01T14:31:00Z", "2026-06-03T18:21:00Z"];
const INDEX_REJOIN = "2026-06-03T18:20:00Z";

interface Rect { left: number; right: number; top: number; bottom: number; cx: number; cy: number }
interface LaneFacts {
  laneX: number; elbow: Rect; elbowTopStyle: string; rail: Rect; railStyle: string; railOpacity: number;
  mergeCount: number; mergeBottom: number | undefined; mergeInFirstLane: boolean;
  bnodes: { cy: number; opacity: number; instant: string }[]; labelRects: Rect[];
  forkCentreY: number | undefined; rejoinCentreY: number | undefined;
}
interface BubbleFacts {
  rect: Rect; laneW: number; trunkRailLeft: number; trunkRailStyle: string; lanes: LaneFacts[];
  trunkOpacities: number[]; mergeCount: number;
}

const BUBBLE_PROBE = (path: string, forks: string[], rejoin: string) => `(b => {
    const rect = (e) => { const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
    const commitCentreY = (instant) => {
        const dot = [...b.querySelectorAll('.node.n-commit')].find(n => Date.parse(n.dataset.instant) === Date.parse(instant));
        return dot ? rect(dot).cy : undefined; };
    const tickCentreY = (instant) => {
        const iso = new Date(instant).toISOString();
        const stamp = iso.slice(5, 10) + ' ' + iso.slice(11, 23);
        const tick = [...document.querySelectorAll('.ruler .tick')].find(t => t.textContent.startsWith(stamp));
        return tick ? rect(tick).cy : undefined; };
    const lanes = [...b.querySelectorAll('.blane')];
    const rejoinInstant = ${JSON.stringify(rejoin)};
    return {
        rect: rect(b),
        laneW: parseFloat(getComputedStyle(b).getPropertyValue('--lane-w')),
        trunkRailLeft: rect(b.querySelector('.lrail')).left - b.getBoundingClientRect().left,
        trunkRailStyle: getComputedStyle(b.querySelector('.lrail')).borderLeftStyle,
        trunkOpacities: [...b.querySelectorAll('.lane > .node')].filter(n => getComputedStyle(n).visibility !== 'hidden')
            .map(n => parseFloat(getComputedStyle(n).opacity)),
        mergeCount: b.querySelectorAll('.merge-elbow').length,
        lanes: lanes.map((lane, i) => {
            const merge = lane.querySelector('.merge-elbow');
            return {
                laneX: rect(lane).left,
                elbow: rect(lane.querySelector('.split-elbow')),
                elbowTopStyle: getComputedStyle(lane.querySelector('.split-elbow')).borderTopStyle,
                rail: rect(lane.querySelector('.brail')),
                railStyle: getComputedStyle(lane.querySelector('.brail')).borderLeftStyle,
                railOpacity: parseFloat(getComputedStyle(lane.querySelector('.brail')).opacity),
                mergeCount: lane.querySelectorAll('.merge-elbow').length,
                mergeBottom: merge ? rect(merge).bottom : undefined,
                mergeInFirstLane: merge ? merge.closest('.blane') === lanes[0] : false,
                bnodes: [...lane.querySelectorAll('.bnode')].map(n => ({ cy: rect(n).cy, opacity: parseFloat(getComputedStyle(n).opacity), instant: n.dataset.instant })),
                labelRects: [...lane.querySelectorAll('.blabel')].map(rect),
                forkCentreY: tickCentreY(${JSON.stringify(forks)}[i]),
                rejoinCentreY: merge ? commitCentreY(rejoinInstant) : undefined };
        }) };
})(document.querySelector(${JSON.stringify(bubbleOf(path))}))`;

const PLAIN_BUBBLE_TRUNK_RAIL_LEFT = `(b => b.querySelector('.lrail').getBoundingClientRect().left - b.getBoundingClientRect().left)
    ([...document.querySelectorAll('.filebox')].find(b => b.querySelector('.fname[data-path]') && !b.querySelector('.blane')))`;
const TICK_ROWS = `[...document.querySelectorAll('.ruler .tick')].map(t => { const r = t.getBoundingClientRect(); return { text: t.textContent, cy: r.top + r.height / 2 }; })`;
// A tick reads "MM-DD HH:MM:SS.mmm (n)" in UTC; this is that stamp for an ISO instant.
const toTickStamp = (instant: string) => `${instant.slice(5, 10)} ${instant.slice(11, 23)}`;

const isNear = (a: number | undefined, b: number | undefined) =>
  a !== undefined && b !== undefined && Math.abs(a - b) <= TOLERANCE_PX;

function checkTrunkAndRails(label: string, bubble: BubbleFacts, plainRailLeft: number): void {
  reportCheck(`L5 ${label}: the trunk rail is solid`, bubble.trunkRailStyle === "solid", bubble.trunkRailStyle);
  reportCheck(`L5 ${label}: the trunk rail sits where it sits in a bubble with no branches`,
    isNear(bubble.trunkRailLeft, plainRailLeft), { bubble: bubble.trunkRailLeft, plain: plainRailLeft });
  reportCheck(`L5 ${label}: every branch rail is dashed and dimmer than 1`,
    bubble.lanes.every((lane) => lane.railStyle === "dashed" && lane.railOpacity < 1),
    bubble.lanes.map((lane) => [lane.railStyle, lane.railOpacity]));
  const branchOpacities = bubble.lanes.flatMap((lane) => lane.bnodes.map((node) => node.opacity));
  reportCheck(`L5 ${label}: every branch dot has opacity .38`,
    branchOpacities.length > 0 && branchOpacities.every((opacity) => isNear(opacity, BNODE_OPACITY)), branchOpacities);
  reportCheck(`L5 ${label}: every visible trunk node has opacity 1`,
    bubble.trunkOpacities.length > 0 && bubble.trunkOpacities.every((opacity) => opacity === 1), bubble.trunkOpacities);
}

function checkElbows(label: string, bubble: BubbleFacts): void {
  const trunkLeft = bubble.rect.left + bubble.trunkRailLeft;
  reportCheck(`L5 ${label}: every split elbow starts level with its forkAt ruler tick, at the trunk rail, and ends at its lane, and is dashed`,
    bubble.lanes.every((lane) => isNear(lane.elbow.top, lane.forkCentreY) && isNear(lane.elbow.left, trunkLeft)
      && isNear(lane.elbow.right, lane.rail.cx) && lane.elbowTopStyle === "dashed"),
    bubble.lanes.map((lane) => ({ elbow: lane.elbow, fork: lane.forkCentreY, railCx: lane.rail.cx, style: lane.elbowTopStyle, trunkLeft })));
}

function checkWidening(bubble: BubbleFacts, utilBubble: BubbleFacts): void {
  const inside = (rect: Rect) => rect.left >= bubble.rect.left - TOLERANCE_PX && rect.right <= bubble.rect.right + TOLERANCE_PX;
  reportCheck("L5 index.ts: every lane and every branch label sits inside the bubble rect",
    bubble.lanes.every((lane) => lane.laneX >= bubble.rect.left && lane.laneX <= bubble.rect.right && lane.labelRects.every(inside)),
    { bubble: bubble.rect, lanes: bubble.lanes.map((lane) => [lane.laneX, lane.labelRects.map((r) => r.right)]) });
  const xs = bubble.lanes.map((lane) => lane.laneX);
  reportCheck("L5 index.ts: lane x positions differ by at least the lane width",
    xs.every((x, i) => i === 0 || x - xs[i - 1]! >= bubble.laneW - TOLERANCE_PX), { xs, laneW: bubble.laneW });
  reportCheck("L5 index.ts: the bubble is wider than the src/util.ts bubble",
    bubble.rect.right - bubble.rect.left > utilBubble.rect.right - utilBubble.rect.left, [bubble.rect, utilBubble.rect]);
}

export async function checkLayer5(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && document.getElementById('loadbar').hidden`, 30_000);
  reportCheck("L5 before the branch box: no lane is drawn and the box is unchecked",
    await page.evaluate<boolean>(`document.querySelectorAll('.blane').length === 0 && ${BRANCH_BOX}.checked === false`));
  await page.evaluate(`${BRANCH_BOX}.click()`);
  await page.waitFor(`document.querySelectorAll('.blane').length > 0 && document.getElementById('loadbar').hidden`, 30_000);
  const util = await page.evaluate<BubbleFacts>(BUBBLE_PROBE(UTIL_PATH, UTIL_FORKS, ""));
  const index = await page.evaluate<BubbleFacts>(BUBBLE_PROBE(INDEX_PATH, INDEX_FORKS, INDEX_REJOIN));
  const plainRailLeft = await page.evaluate<number>(PLAIN_BUBBLE_TRUNK_RAIL_LEFT);

  reportCheck("L5 src/util.ts has 1 branch lane and src/index.ts has 2", util.lanes.length === 1 && index.lanes.length === 2,
    [util.lanes.length, index.lanes.length]);
  checkTrunkAndRails("util.ts", util, plainRailLeft);
  checkTrunkAndRails("index.ts", index, plainRailLeft);
  checkElbows("util.ts", util);
  checkElbows("index.ts", index);

  reportCheck("L5 util.ts has 0 merge elbows", util.mergeCount === 0, util.mergeCount);
  const merge = index.lanes[0];
  reportCheck("L5 index.ts has exactly 1 merge elbow, in the first lane, ending at the rejoin commit dot centre",
    index.mergeCount === 1 && merge !== undefined && merge.mergeInFirstLane && isNear(merge.mergeBottom, merge.rejoinCentreY),
    { count: index.mergeCount, bottom: merge?.mergeBottom, rejoin: merge?.rejoinCentreY, inFirst: merge?.mergeInFirstLane });

  reportCheck("L5 no element class contains rewind", await page.evaluate<number>(`document.querySelectorAll('[class*="rewind"]').length`) === 0);
  checkWidening(index, util);

  const ticks = await page.evaluate<{ text: string; cy: number }[]>(TICK_ROWS);
  const branchNodes = [...util.lanes, ...index.lanes].flatMap((lane) => lane.bnodes);
  const unmatched = branchNodes.filter((node) =>
    !ticks.some((tick) => tick.text.startsWith(toTickStamp(node.instant)) && isNear(tick.cy, node.cy)));
  reportCheck("L5 every branch dot sits level with the ruler tick of its own instant",
    branchNodes.length === 6 && unmatched.length === 0, unmatched);
  const laneCentres = [...util.lanes, ...index.lanes].map((lane) => ({ elbowTop: lane.elbow.top, railBottom: lane.rail.bottom, ys: lane.bnodes.map((node) => node.cy) }));
  reportCheck("L5 every branch dot sits on its own lane rail, below the split elbow, at its own row",
    laneCentres.every((lane) => lane.ys.every((cy, i) => cy >= lane.elbowTop && cy <= lane.railBottom + TOLERANCE_PX && (i === 0 || cy > lane.ys[i - 1]!))),
    laneCentres);
  reportCheck("L5 exactly one ruler", await page.evaluate<number>(`document.querySelectorAll('.ruler').length`) === 1);

  // The bubbles are 10000px tall and index.ts sits left of util.ts: pan to index.ts, then down to its first fork, clear of the ruler.
  const indexBubble = `document.querySelector(${JSON.stringify(bubbleOf(INDEX_PATH))})`;
  await page.evaluate(`${indexBubble}.scrollIntoView({ block: 'nearest', inline: 'start' });
        ${indexBubble}.querySelector('.split-elbow').scrollIntoView({ block: 'start', inline: 'nearest' });
        document.querySelector('.timelines').scrollBy(-190, -120)`);
  await saveScreenshot(page, "10-layer5-branches");
  console.log("L5 screenshot: scripts/visual/out/mockup-10-layer5-branches.png");

  await checkLaneNodeClicks(page, "L5", { max: 2 });
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && document.getElementById('loadbar').hidden`, 30_000);
}

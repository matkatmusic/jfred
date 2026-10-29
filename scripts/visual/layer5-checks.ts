// Layer 5 (forked branch lanes) checks on the fixture-mode page; mockup.ts calls validateLayer5.

import { type HeadlessPage } from "./cdp.ts";
import { buildBubbleProbe, isNear, PLAIN_BUBBLE_TRUNK_RAIL_LEFT, TICK_ROWS, type BubbleFacts } from "./layer5-bubble-facts.ts";
import { validateDotRows, validateElbows, validateTrunkAndRails, validateWidening } from "./layer5-bubble-checks.ts";
import { validateLaneNodeClicks } from "./layer5-lane-click.ts";
import { buildBubbleSelector, reportCheck, saveScreenshot } from "./mockup-checks.ts";

const UTIL_PATH = "src/util.ts";
const INDEX_PATH = "src/index.ts";
// Fork and rejoin instants of the canned lanes (src/viewer_api_layer5_mockup_branches.ts): a fork owns a tick.
const BRANCH_BOX = `document.querySelector('#show-row input[data-kind="branch"]')`;
const UTIL_FORKS = ["2026-06-01T14:31:00Z"];
const INDEX_FORKS = ["2026-06-01T14:31:00Z", "2026-06-03T18:21:00Z"];
const INDEX_REJOIN = "2026-06-03T18:20:00Z";

export async function validateLayer5(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && document.getElementById('loadbar').hidden`, 30_000);
  reportCheck("L5 before the branch box: no lane is drawn and the box is unchecked",
    await page.evaluate<boolean>(`document.querySelectorAll('.blane').length === 0 && ${BRANCH_BOX}.checked === false`));
  await page.evaluate(`${BRANCH_BOX}.click()`);
  await page.waitFor(`document.querySelectorAll('.blane').length > 0 && document.getElementById('loadbar').hidden`, 30_000);
  const util = await page.evaluate<BubbleFacts>(buildBubbleProbe(UTIL_PATH, UTIL_FORKS, ""));
  const index = await page.evaluate<BubbleFacts>(buildBubbleProbe(INDEX_PATH, INDEX_FORKS, INDEX_REJOIN));
  const plainRailLeft = await page.evaluate<number>(PLAIN_BUBBLE_TRUNK_RAIL_LEFT);

  reportCheck("L5 src/util.ts has 1 branch lane and src/index.ts has 2", util.lanes.length === 1 && index.lanes.length === 2,
    [util.lanes.length, index.lanes.length]);
  validateTrunkAndRails("util.ts", util, plainRailLeft);
  validateTrunkAndRails("index.ts", index, plainRailLeft);
  validateElbows("util.ts", util);
  validateElbows("index.ts", index);

  reportCheck("L5 util.ts has 0 merge elbows", util.mergeCount === 0, util.mergeCount);
  const merge = index.lanes[0];
  reportCheck("L5 index.ts has exactly 1 merge elbow, in the first lane, ending at the rejoin commit dot centre",
    index.mergeCount === 1 && merge !== undefined && merge.mergeInFirstLane && isNear(merge.mergeBottom, merge.rejoinCentreY),
    { count: index.mergeCount, bottom: merge?.mergeBottom, rejoin: merge?.rejoinCentreY, inFirst: merge?.mergeInFirstLane });

  reportCheck("L5 no element class contains rewind", await page.evaluate<number>(`document.querySelectorAll('[class*="rewind"]').length`) === 0);
  validateWidening(index, util);

  const ticks = await page.evaluate<{ text: string; cy: number }[]>(TICK_ROWS);
  validateDotRows([...util.lanes, ...index.lanes], ticks);
  reportCheck("L5 exactly one ruler", await page.evaluate<number>(`document.querySelectorAll('.ruler').length`) === 1);

  // Bubbles are 10000px tall: pan to index.ts, then down to its first fork, clear of the ruler.
  const indexBubble = `document.querySelector(${JSON.stringify(buildBubbleSelector(INDEX_PATH))})`;
  await page.evaluate(`${indexBubble}.scrollIntoView({ block: 'nearest', inline: 'start' });
        ${indexBubble}.querySelector('.split-elbow').scrollIntoView({ block: 'start', inline: 'nearest' });
        document.querySelector('.timelines').scrollBy(-190, -120)`);
  await saveScreenshot(page, "10-layer5-branches");
  console.log("L5 screenshot: scripts/visual/out/mockup-10-layer5-branches.png");

  await validateLaneNodeClicks(page, "L5", { max: 2 });
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && document.getElementById('loadbar').hidden`, 30_000);
}

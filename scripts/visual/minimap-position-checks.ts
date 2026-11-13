// Minimap position checks: the minimap starts at the rightmost ruler-side edge and stays pinned while the pane scrolls.

import { type HeadlessPage } from "./cdp.ts";
import { isNear } from "./layer7-facts.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { COMMIT_MODE_CLICK } from "./layer9-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { DISMISS_RUN_CONSENT } from "./ruler-ui-commit-checks.ts";
import { SESSION_TOGGLE_CLICK } from "./ruler-ui-probes.ts";
import { toggleColumn } from "./ruler-ui-session-checks.ts";

export interface MinimapEdgeFacts { minimapLeft: number; rulerRight: number | null; drawerRight: number | null }
export interface MinimapRect { left: number; top: number; width: number; height: number }
export interface MinimapPinFacts { rectBefore: MinimapRect; rectAfterScrollForward: MinimapRect; rectAfterScrollBackward: MinimapRect; borderRadius: string }

const EDGE_TOLERANCE_PX = 1;
const PIN_TOLERANCE_PX = 0.5;
const SQUARE_CORNER_RADIUS = "0px";
const SCROLL_DISTANCE_PX = 600;
const SETTLE = `new Promise(resolve => setTimeout(resolve, 300))`;
const SESSION_COLUMN_ID = "sessionDotLinesComponent";
const COMMIT_DRAWER_ID = "jfredCommitsDrawerComponent";

const READ_RECT = `(element => { const box = element.getBoundingClientRect(); return { left: box.left, top: box.top, width: box.width, height: box.height }; })`;

const MINIMAP_EDGE_FACTS = `(async () => {
    await ${SETTLE};
    const drawer = document.getElementById('${COMMIT_DRAWER_ID}');
    return { minimapLeft: document.getElementById('minimapComponent').getBoundingClientRect().left,
        rulerRight: document.getElementById('timelineRulerContainer').getBoundingClientRect().right,
        drawerRight: drawer === null ? null : drawer.getBoundingClientRect().right };
})()`;

const buildScrollByAndReadRect = (distancePx: number) => `(async () => {
    const pane = document.getElementById('timelineContainer');
    pane.scrollLeft += ${distancePx};
    pane.scrollTop += ${distancePx};
    await ${SETTLE};
    return ${READ_RECT}(document.getElementById('minimapComponent'));
})()`;

const MINIMAP_PIN_START = `(async () => {
    const pane = document.getElementById('timelineContainer');
    await ${SETTLE};
    return { rect: ${READ_RECT}(document.getElementById('minimapComponent')), scrollLeft: pane.scrollLeft, scrollTop: pane.scrollTop,
        borderRadius: getComputedStyle(document.getElementById('minimapComponent')).borderRadius };
})()`;

const buildScrollTo = (scrollLeft: number, scrollTop: number) => `(async () => {
    const pane = document.getElementById('timelineContainer');
    pane.scrollLeft = ${scrollLeft};
    pane.scrollTop = ${scrollTop};
    await ${SETTLE};
})()`;

interface MinimapPinStart { rect: MinimapRect; scrollLeft: number; scrollTop: number; borderRadius: string }

export function isMinimapTouchingRightmostEdge(facts: MinimapEdgeFacts): boolean {
  const rightEdges: number[] = [];
  if (facts.rulerRight !== null) {
    rightEdges.push(facts.rulerRight);
  }
  if (facts.drawerRight !== null) {
    rightEdges.push(facts.drawerRight);
  }
  if (rightEdges.length === 0) {
    return false;
  }
  return isNear(facts.minimapLeft, Math.max(...rightEdges), EDGE_TOLERANCE_PX);
}

function isRectNear(first: MinimapRect, second: MinimapRect): boolean {
  const isLeftNear = isNear(first.left, second.left, PIN_TOLERANCE_PX);
  const isTopNear = isNear(first.top, second.top, PIN_TOLERANCE_PX);
  const isWidthNear = isNear(first.width, second.width, PIN_TOLERANCE_PX);
  const isHeightNear = isNear(first.height, second.height, PIN_TOLERANCE_PX);
  return isLeftNear && isTopNear && isWidthNear && isHeightNear;
}

export function isMinimapPinnedAfterScroll(facts: MinimapPinFacts): boolean {
  const isForwardPinned = isRectNear(facts.rectBefore, facts.rectAfterScrollForward);
  const isBackwardPinned = isRectNear(facts.rectBefore, facts.rectAfterScrollBackward);
  return isForwardPinned && isBackwardPinned && facts.borderRadius !== SQUARE_CORNER_RADIUS;
}

async function validateMinimapEdge(page: HeadlessPage, label: string): Promise<void> {
  const facts = await page.evaluate<MinimapEdgeFacts>(MINIMAP_EDGE_FACTS);
  reportCheck(`MINIMAP edge ${label}: the minimap left is within 1px of the rightmost ruler-side edge`, isMinimapTouchingRightmostEdge(facts), facts);
}

async function toggleSessionLines(page: HeadlessPage, isOn: boolean): Promise<void> {
  await toggleColumn(page, SESSION_TOGGLE_CLICK, SESSION_COLUMN_ID, isOn);
}

async function toggleCommitDrawer(page: HeadlessPage, isOn: boolean): Promise<void> {
  await toggleColumn(page, COMMIT_MODE_CLICK, COMMIT_DRAWER_ID, isOn);
  if (isOn) {
    await page.evaluate(DISMISS_RUN_CONSENT);
  }
}

// Starts and ends with session lines off and Commit mode off.
async function validateMinimapEdges(page: HeadlessPage): Promise<void> {
  await validateMinimapEdge(page, "session lines off, Commit mode off");
  await toggleSessionLines(page, true);
  await validateMinimapEdge(page, "session lines on, Commit mode off");
  await toggleCommitDrawer(page, true);
  await validateMinimapEdge(page, "session lines on, Commit mode on");
  await toggleSessionLines(page, false);
  await validateMinimapEdge(page, "session lines off, Commit mode on");
  await toggleCommitDrawer(page, false);
  console.log("MINIMAP edge combos run: session off/commit off, session on/commit off, session on/commit on, session off/commit on");
}

// Ends with the pane scrolled back to where it started.
async function validateMinimapPin(page: HeadlessPage): Promise<void> {
  const start = await page.evaluate<MinimapPinStart>(MINIMAP_PIN_START);
  const rectAfterScrollForward = await page.evaluate<MinimapRect>(buildScrollByAndReadRect(SCROLL_DISTANCE_PX));
  const rectAfterScrollBackward = await page.evaluate<MinimapRect>(buildScrollByAndReadRect(-2 * SCROLL_DISTANCE_PX));
  await page.evaluate(buildScrollTo(start.scrollLeft, start.scrollTop));
  const facts: MinimapPinFacts = { rectBefore: start.rect, rectAfterScrollForward, rectAfterScrollBackward, borderRadius: start.borderRadius };
  reportCheck("MINIMAP pin: scrolling the pane 600px forward and 600px back leaves the minimap rect in place, and its corners are round", isMinimapPinnedAfterScroll(facts), facts);
}

export async function validateMinimapPosition(page: HeadlessPage, pageUrl: string): Promise<void> {
  await validateMinimapEdges(page);
  await validateMinimapPin(page);
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

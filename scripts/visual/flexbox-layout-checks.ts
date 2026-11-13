// Flexbox layout checks: the sources split, the bubble container beside the details pane, the pane size, edge and drag limits, and the session lines overlay; validateFlexboxLayout leaves a fresh page behind.

import { type HeadlessPage, type MouseHeadlessPage } from "./cdp.ts";
import { isNear } from "./layer7-facts.ts";
import { reportCheck } from "./mockup-checks.ts";
import { toggleSessionDotLines } from "./ruler-ui-session-checks.ts";

export interface SourcesSplitFacts { fileNavHeight: number; jsonlsHeight: number }
export interface SourcesMinimumFacts { smallestFileNavHeight: number; smallestJsonlsHeight: number }
export interface BubbleContainerWidthFacts { widthBefore: number; widthAfter: number; paneParentId: string }
export interface PaneInitialWidthFacts { paneWidth: number; scrollBoxRight: number; overlayRightEdge: number }
export interface PaneRightEdgeFacts { paneRight: number; scrollBoxRight: number }
export interface PaneDragFacts { paneWidth: number; visibleWidth: number }
export interface SessionLinesFacts {
  firstBubbleLeftBefore: number; firstBubbleLeftAfter: number;
  rulerContainerRightBefore: number; rulerContainerRightAfter: number;
  trackWidth: number; bubbleContainerLeft: number;
}

interface Point { x: number; y: number }
interface SourcesBox { top: number; bottom: number }
interface SessionLinesEdges { firstBubbleLeft: number; rulerContainerRight: number; bubbleContainerLeft: number; trackWidth: number }
interface PaneGeometry { paneWidth: number; paneRight: number; scrollBoxRight: number; overlayRightEdge: number; paneParentId: string; containerWidth: number }

const SPLIT_TOLERANCE_PX = 1;
const MIN_SOURCES_PANE_HEIGHT_PX = 80;
const MIN_SOURCES_PANE_TOLERANCE_PX = 0.5;
const CONTAINER_WIDTH_TOLERANCE_PX = 0.5;
const PANE_TOLERANCE_PX = 1;
const PANE_PARENT_ID = "fileBubbleContainer";
const INITIAL_PANE_SHARE = 0.35;
const MAX_PANE_SHARE = 0.5;
const MIN_PANE_SHARE = 0.3;
const SCROLL_DISTANCE_PX = 400;
const FIRST_BUBBLE_TOLERANCE_PX = 0.5;
const RULER_GROWTH_TOLERANCE_PX = 1;

export function isSourcesSplitThreeToTwo(facts: SourcesSplitFacts): boolean {
  return isNear(facts.fileNavHeight, facts.jsonlsHeight * 1.5, SPLIT_TOLERANCE_PX);
}

export function isSourcesSplitHeldAtMinimum(facts: SourcesMinimumFacts): boolean {
  const floor = MIN_SOURCES_PANE_HEIGHT_PX - MIN_SOURCES_PANE_TOLERANCE_PX;
  return facts.smallestFileNavHeight >= floor && facts.smallestJsonlsHeight >= floor;
}

export function isBubbleContainerWidthUnchangedByPane(facts: BubbleContainerWidthFacts): boolean {
  return isNear(facts.widthBefore, facts.widthAfter, CONTAINER_WIDTH_TOLERANCE_PX) && facts.paneParentId === PANE_PARENT_ID;
}

export function isPaneInitialWidthThirtyFivePercent(facts: PaneInitialWidthFacts): boolean {
  const visibleWidth = facts.scrollBoxRight - facts.overlayRightEdge;
  return isNear(facts.paneWidth, visibleWidth * INITIAL_PANE_SHARE, PANE_TOLERANCE_PX);
}

export function isPaneStillAtTheRightEdgeAfterScrolling(facts: PaneRightEdgeFacts): boolean {
  return isNear(facts.paneRight, facts.scrollBoxRight, PANE_TOLERANCE_PX);
}

export function isPaneDragStoppedAtFiftyPercent(facts: PaneDragFacts): boolean {
  return isNear(facts.paneWidth, facts.visibleWidth * MAX_PANE_SHARE, PANE_TOLERANCE_PX);
}

export function isPaneDragStoppedAtThirtyPercent(facts: PaneDragFacts): boolean {
  return isNear(facts.paneWidth, facts.visibleWidth * MIN_PANE_SHARE, PANE_TOLERANCE_PX);
}

export function isFirstBubbleUnmovedBySessionLines(facts: SessionLinesFacts): boolean {
  return Math.abs(facts.firstBubbleLeftAfter - facts.firstBubbleLeftBefore) < FIRST_BUBBLE_TOLERANCE_PX;
}

export function isRulerContainerGrownByTrackWidth(facts: SessionLinesFacts): boolean {
  return isNear(facts.rulerContainerRightAfter - facts.rulerContainerRightBefore, facts.trackWidth, RULER_GROWTH_TOLERANCE_PX);
}

export function isGrownPartOverBubbleContainer(facts: SessionLinesFacts): boolean {
  return facts.rulerContainerRightAfter > facts.bubbleContainerLeft;
}

const READ_SOURCES_HEIGHTS = `(() => ({
    fileNavHeight: document.getElementById('fileNavComponent').getBoundingClientRect().height,
    jsonlsHeight: document.getElementById('jsonlsComponent').getBoundingClientRect().height,
}))()`;
const READ_SOURCES_BOX = `(() => {
    const box = document.getElementById('sourcesContainer').getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
})()`;
const READ_PANE_GEOMETRY = `(() => {
    const pane = document.getElementById('detailsPaneContainer');
    const paneBox = pane.getBoundingClientRect();
    const scrollBox = document.getElementById('timelineContainer');
    const overlayRights = ['timelineRulerComponent', 'sessionDotLinesComponent', 'jfredCommitsDrawerComponent']
        .map(id => document.getElementById(id))
        .filter(element => element !== null)
        .map(element => element.getBoundingClientRect().right);
    return {
        paneWidth: paneBox.width, paneRight: paneBox.right, scrollBoxRight: scrollBox.getBoundingClientRect().left + scrollBox.clientWidth,
        overlayRightEdge: Math.max(...overlayRights), paneParentId: pane.parentElement.id,
        containerWidth: document.getElementById('fileBubbleContainer').getBoundingClientRect().width,
    };
})()`;
const READ_SESSION_LINES_EDGES = `(() => {
    const track = document.getElementById('sessionDotLinesComponent');
    return {
        firstBubbleLeft: document.querySelector('.filebox').getBoundingClientRect().left,
        rulerContainerRight: document.getElementById('timelineRulerContainer').getBoundingClientRect().right,
        bubbleContainerLeft: document.getElementById('fileBubbleContainer').getBoundingClientRect().left,
        trackWidth: track === null ? 0 : track.getBoundingClientRect().width,
    };
})()`;
const READ_CONTAINER_WIDTH =`document.getElementById('fileBubbleContainer').getBoundingClientRect().width`;
const CLICK_BUBBLE_NODE = `document.querySelector('i.n-snap').click()`;
const PANE_IS_OPEN = `document.getElementById('detailsPaneContainer').classList.contains('open')`;
const SCROLL_RIGHT = `(() => {
    const scrollBox = document.getElementById('timelineContainer');
    const before = scrollBox.scrollLeft;
    scrollBox.scrollLeft = before + ${SCROLL_DISTANCE_PX};
    return scrollBox.scrollLeft - before;
})()`;
const WAIT_FOR_FRAME = `new Promise(resolve => requestAnimationFrame(() => resolve(true)))`;

function buildReadGripCentre(gripId: string): string {
  return `(() => {
    const box = document.getElementById('${gripId}').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
})()`;
}

// A HeadlessPage from openHeadlessPage is always a MouseHeadlessPage; a bare page cannot drag, so fail loudly.
function getMouseHeadlessPage(page: HeadlessPage): MouseHeadlessPage {
  if (!("dispatchMouse" in page)) {
    throw new Error("flexbox layout checks need real mouse input: the page has no dispatchMouse");
  }
  return page as MouseHeadlessPage;
}

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && document.querySelectorAll('.n-snap').length > 0`, 30_000);
}

async function dragGripTo(page: MouseHeadlessPage, gripId: string, targetX: number, targetY: number): Promise<void> {
  const grip = await page.evaluate<Point>(buildReadGripCentre(gripId));
  await page.dispatchMouse("mouseMoved", grip.x, grip.y);
  await page.dispatchMouse("mousePressed", grip.x, grip.y);
  await page.dispatchMouse("mouseMoved", targetX, targetY);
  await page.dispatchMouse("mouseReleased", targetX, targetY);
}

async function measureSourcesHeightsAfterDragTo(page: MouseHeadlessPage, targetY: number): Promise<SourcesSplitFacts> {
  const grip = await page.evaluate<Point>(buildReadGripCentre("navpane-grip"));
  await dragGripTo(page, "navpane-grip", grip.x, targetY);
  return page.evaluate<SourcesSplitFacts>(READ_SOURCES_HEIGHTS);
}

export async function validateSourcesSplit(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<SourcesSplitFacts>(READ_SOURCES_HEIGHTS);
  reportCheck("FLEX at load the file nav and the jsonls pane share the sources height 3:2", isSourcesSplitThreeToTwo(facts), facts);
}

export async function validateSourcesMinimum(page: MouseHeadlessPage): Promise<void> {
  const box = await page.evaluate<SourcesBox>(READ_SOURCES_BOX);
  const atTop = await measureSourcesHeightsAfterDragTo(page, box.top);
  const atBottom = await measureSourcesHeightsAfterDragTo(page, box.bottom);
  const facts: SourcesMinimumFacts = {
    smallestFileNavHeight: Math.min(atTop.fileNavHeight, atBottom.fileNavHeight),
    smallestJsonlsHeight: Math.min(atTop.jsonlsHeight, atBottom.jsonlsHeight),
  };
  reportCheck("FLEX dragging the sources grip to the top edge and the bottom edge leaves each pane at least 80px tall", isSourcesSplitHeldAtMinimum(facts), { atTop, atBottom });
}

export async function validatePaneOpening(page: HeadlessPage): Promise<PaneGeometry> {
  const widthBefore = await page.evaluate<number>(READ_CONTAINER_WIDTH);
  await page.evaluate(CLICK_BUBBLE_NODE);
  await page.waitFor(PANE_IS_OPEN, 5_000);
  await page.evaluate(WAIT_FOR_FRAME);
  const geometry = await page.evaluate<PaneGeometry>(READ_PANE_GEOMETRY);
  const widthFacts: BubbleContainerWidthFacts = { widthBefore, widthAfter: geometry.containerWidth, paneParentId: geometry.paneParentId };
  reportCheck("FLEX opening the details pane leaves #fileBubbleContainer the same width and puts the pane inside it", isBubbleContainerWidthUnchangedByPane(widthFacts), widthFacts);
  const initialFacts: PaneInitialWidthFacts = { paneWidth: geometry.paneWidth, scrollBoxRight: geometry.scrollBoxRight, overlayRightEdge: geometry.overlayRightEdge };
  reportCheck("FLEX the details pane opens 35% of the visible bubble width", isPaneInitialWidthThirtyFivePercent(initialFacts), initialFacts);
  return geometry;
}

export async function validatePaneRightEdge(page: HeadlessPage): Promise<void> {
  const scrolledPx = await page.evaluate<number>(SCROLL_RIGHT);
  if (scrolledPx <= 0) {
    throw new Error("#timelineContainer did not scroll right, so the right edge check would prove nothing");
  }
  await page.evaluate(WAIT_FOR_FRAME);
  const geometry = await page.evaluate<PaneGeometry>(READ_PANE_GEOMETRY);
  const facts: PaneRightEdgeFacts = { paneRight: geometry.paneRight, scrollBoxRight: geometry.scrollBoxRight };
  reportCheck("FLEX after the scroll box scrolls right 400px the details pane right edge is still the scroll box right edge", isPaneStillAtTheRightEdgeAfterScrolling(facts), facts);
}

async function measurePaneAfterDragTo(page: MouseHeadlessPage, targetX: number): Promise<PaneDragFacts> {
  const grip = await page.evaluate<Point>(buildReadGripCentre("details-pane-grip"));
  await dragGripTo(page, "details-pane-grip", targetX, grip.y);
  const geometry = await page.evaluate<PaneGeometry>(READ_PANE_GEOMETRY);
  return { paneWidth: geometry.paneWidth, visibleWidth: geometry.scrollBoxRight - geometry.overlayRightEdge };
}

export async function validatePaneDrag(page: MouseHeadlessPage, scrollBoxRight: number): Promise<void> {
  const farLeft = await measurePaneAfterDragTo(page, 0);
  reportCheck("FLEX dragging the pane grip far left stops the pane at 50% of the visible bubble width", isPaneDragStoppedAtFiftyPercent(farLeft), farLeft);
  const farRight = await measurePaneAfterDragTo(page, scrollBoxRight - 1);
  reportCheck("FLEX dragging the pane grip far right stops the pane at 30% of the visible bubble width", isPaneDragStoppedAtThirtyPercent(farRight), farRight);
}

export async function validateSessionLinesOverlay(page: HeadlessPage): Promise<void> {
  const before = await page.evaluate<SessionLinesEdges>(READ_SESSION_LINES_EDGES);
  await toggleSessionDotLines(page, true);
  await page.evaluate(WAIT_FOR_FRAME);
  const after = await page.evaluate<SessionLinesEdges>(READ_SESSION_LINES_EDGES);
  const facts: SessionLinesFacts = {
    firstBubbleLeftBefore: before.firstBubbleLeft, firstBubbleLeftAfter: after.firstBubbleLeft,
    rulerContainerRightBefore: before.rulerContainerRight, rulerContainerRightAfter: after.rulerContainerRight,
    trackWidth: after.trackWidth, bubbleContainerLeft: after.bubbleContainerLeft,
  };
  reportCheck("FLEX turning the session lines on does not move the left edge of the first bubble", isFirstBubbleUnmovedBySessionLines(facts), facts);
  reportCheck("FLEX turning the session lines on grows the ruler container right edge by the track width", isRulerContainerGrownByTrackWidth(facts), facts);
  reportCheck("FLEX the grown part of the ruler container lies over the bubble container", isGrownPartOverBubbleContainer(facts), facts);
  await toggleSessionDotLines(page, false);
}

// The reload at the end resets the pane share, the scroll and the sources split.
export async function validateFlexboxLayout(page: HeadlessPage, pageUrl: string): Promise<void> {
  const mousePage = getMouseHeadlessPage(page);
  await waitForFreshPage(page, pageUrl);
  await validateSourcesSplit(page);
  await validateSourcesMinimum(mousePage);
  await waitForFreshPage(page, pageUrl);
  const geometry = await validatePaneOpening(page);
  await validatePaneRightEdge(page);
  await validatePaneDrag(mousePage, geometry.scrollBoxRight);
  await waitForFreshPage(page, pageUrl);
  await validateSessionLinesOverlay(page);
  await waitForFreshPage(page, pageUrl);
}

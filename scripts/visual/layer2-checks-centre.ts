// Layer 2 centring checks: a node click and a jump-arrow landing centre the node beside the drawer.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { validateArrowLandings } from "./layer2-checks-centre-landings.ts";
import {
  CENTRE_TOLERANCE_PX, EDGE_TOLERANCE_PX, PROBE, formatCentreLine, markProbe, readView, type CentredView,
} from "./layer2-centre-probes.ts";

const MAX_ZOOM_CLICKS = 6;

async function waitUntilNodeCanCentre(page: HeadlessPage): Promise<boolean> {
  for (let clicks = 0; clicks <= MAX_ZOOM_CLICKS; clicks++) {
    const hasInteriorNode = await page.evaluate<boolean>(markProbe(true));
    if (hasInteriorNode) {
      return true;
    }
    await page.evaluate(`document.getElementById('zoom-in').click()`);
    await waitMilliseconds(300);
  }
  return false;
}

async function validateInteriorNode(page: HeadlessPage): Promise<void> {
  const hasProbe = await waitUntilNodeCanCentre(page);
  reportCheck("#drawer-centre a node exists whose centred scroll target is inside the scroll range", hasProbe);
  if (!hasProbe) {
    return;
  }
  await page.evaluate(`${PROBE}.click()`);
  await waitMilliseconds(400);
  const view = await page.evaluate<CentredView>(readView(PROBE));
  console.log(formatCentreLine("node click", view));
  let isCentredOnBothAxes = true;
  for (const offset of view.offset) {
    const distance = Math.abs(offset);
    if (distance > CENTRE_TOLERANCE_PX) {
      isCentredOnBothAxes = false;
    }
  }
  reportCheck("#drawer-centre the clicked node is fully inside the visible timeline", view.isInside, view);
  reportCheck("#drawer-centre the clicked node does not touch the drawer", !view.touchesDrawer, view);
  reportCheck("#drawer-centre the node centre is within 4px of the uncovered area centre on both axes", isCentredOnBothAxes, view);
}

function isAxisSettled(view: CentredView, targets: number[], axis: number): boolean {
  const target = targets[axis]!;
  if (target < 0) {
    return view.scroll[axis]! <= EDGE_TOLERANCE_PX;
  }
  if (target > view.maxScroll[axis]!) {
    return view.scroll[axis]! >= view.maxScroll[axis]! - EDGE_TOLERANCE_PX;
  }
  return Math.abs(view.offset[axis]!) <= CENTRE_TOLERANCE_PX;
}

// An edge node cannot be centred: its target is out of range, so the scroll sits at that end.
async function validateEdgeNode(page: HeadlessPage): Promise<void> {
  const hasProbe = await page.evaluate<boolean>(markProbe(false));
  reportCheck("#drawer-centre a node exists whose centred scroll target is outside the scroll range", hasProbe);
  if (!hasProbe) {
    return;
  }
  const targets = await page.evaluate<number[]>(`window.__centreTargets`);
  await page.evaluate(`${PROBE}.click()`);
  await waitMilliseconds(400);
  const view = await page.evaluate<CentredView>(readView(PROBE));
  console.log(formatCentreLine("edge node click", view));
  let isEveryAxisSettled = true;
  for (const axis of [0, 1]) {
    const axisIsSettled = isAxisSettled(view, targets, axis);
    if (!axisIsSettled) {
      isEveryAxisSettled = false;
    }
  }
  reportCheck("#drawer-centre the edge node is fully inside the visible timeline", view.isInside && !view.touchesDrawer, view);
  reportCheck("#drawer-centre each clamped axis sits exactly at its scroll end, each free axis is centred", isEveryAxisSettled, { targets, view });
}

async function validateDrawerNeverCoversPane(page: HeadlessPage): Promise<void> {
  const view = await page.evaluate<CentredView>(readView(`document.getElementById('stage')`));
  console.log(`CENTRE layout: pane ${JSON.stringify(view.pane)} drawer ${JSON.stringify(view.drawer)} uncovered area ${JSON.stringify(view.area)}`);
  let areaEqualsPane = true;
  for (let index = 0; index < view.area.length; index++) {
    if (view.area[index] !== view.pane[index]) {
      areaEqualsPane = false;
    }
  }
  const drawerClearOfPane = view.drawer[0]! >= view.pane[2]! - EDGE_TOLERANCE_PX;
  reportCheck("#drawer-centre the drawer is a flex sibling: it never covers #timelines, so the uncovered area is the pane",
    drawerClearOfPane && areaEqualsPane, view);
}

export async function validateCentring(page: HeadlessPage): Promise<void> {
  await validateInteriorNode(page);
  await validateEdgeNode(page);
  await validateDrawerNeverCoversPane(page);
  await validateArrowLandings(page);
  await page.evaluate(`document.getElementById('zoom-reset').click()`);
  await waitMilliseconds(300);
}

// Layer 2 arrow landing centring check; split out of layer2-checks-centre.ts.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { CENTRE_TOLERANCE_PX, EDGE_TOLERANCE_PX, formatCentreLine, readView, type CentredView } from "./layer2-centre-probes.ts";

const MAX_ARROW_CLICKS = 6;

export function isFree(view: CentredView, axis: number): boolean {
  return view.scroll[axis]! > EDGE_TOLERANCE_PX && view.scroll[axis]! < view.maxScroll[axis]! - EDGE_TOLERANCE_PX;
}

export function isCentredOnFreeAxes(view: CentredView): boolean {
  for (const axis of [0, 1]) {
    const isAxisCentredOrPinned = !isFree(view, axis) || Math.abs(view.offset[axis]!) <= CENTRE_TOLERANCE_PX;
    if (!isAxisCentredOrPinned) {
      return false;
    }
  }
  return true;
}

// Middle-pane landings: each axis not pinned at a scroll end is centred; one landing has both axes free.
export async function validateArrowLandings(page: HeadlessPage): Promise<void> {
  await page.evaluate(`(() => { const p = document.getElementById('timelines'); p.scrollTop = (p.scrollHeight - p.clientHeight) / 2; p.scrollLeft = (p.scrollWidth - p.clientWidth) / 2; })()`);
  await waitMilliseconds(300);
  const arrow = `document.querySelector('#show-row button[data-jump-kind="snapshot"][data-jump="next"]')`;
  const landings: CentredView[] = [];
  for (let clicks = 0; clicks < MAX_ARROW_CLICKS && !(await page.evaluate<boolean>(`${arrow}.disabled`)); clicks++) {
    await page.evaluate(`${arrow}.click()`);
    await waitMilliseconds(300);
    const view = await page.evaluate<CentredView>(readView(`document.querySelector('#stage .node.found')`));
    console.log(formatCentreLine(`arrow landing ${clicks + 1}`, view));
    landings.push(view);
  }
  let everyLandingIsClear = true;
  let everyLandingIsCentred = true;
  let someLandingIsFreeOnBothAxes = false;
  for (const view of landings) {
    const landingIsClear = view.isInside && !view.touchesDrawer;
    if (!landingIsClear) {
      everyLandingIsClear = false;
    }
    const landingIsCentred = isCentredOnFreeAxes(view);
    if (!landingIsCentred) {
      everyLandingIsCentred = false;
    }
    const isFreeOnX = isFree(view, 0);
    const isFreeOnY = isFree(view, 1);
    const landingIsFreeOnBothAxes = isFreeOnX && isFreeOnY;
    if (landingIsFreeOnBothAxes) {
      someLandingIsFreeOnBothAxes = true;
    }
  }
  reportCheck("#drawer-centre the arrow landed at least once", landings.length > 0);
  reportCheck("#drawer-centre every arrow landing is inside the pane and clear of the drawer", everyLandingIsClear, landings);
  reportCheck("#drawer-centre on every arrow landing each axis not pinned at a scroll end is centred within 4px", everyLandingIsCentred, landings);
  reportCheck("#drawer-centre at least one arrow landing was free on both axes (a true centring, not a clamp)", someLandingIsFreeOnBothAxes, landings);
}

// Layer 2 centring checks: a node click and a jump-arrow landing centre the node in the part of #timelines the drawer leaves uncovered.
//
// Boxes are [left, top, right, bottom]. TRAP: the probes are template literals, so no backtick or dollar-brace inside them.

import { pause, type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

// Rounding slack for a "centred" claim, and the distance from a scroll end that still counts as sitting at it.
const CENTRE_TOLERANCE_PX = 4;
const EDGE_TOLERANCE_PX = 1;
// A node counts as freely centrable only when its target scroll is this far inside [0, scrollMax].
const INTERIOR_MARGIN_PX = 10;
const MAX_ZOOM_CLICKS = 6;
const MAX_ARROW_CLICKS = 6;

const DEFINE_MEASURE = `
    const pane = document.getElementById('timelines');
    const read = (element) => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
    const paneBox = read(pane);
    const drawerBox = read(document.getElementById('drawer'));
    const area = [...paneBox];
    if (drawerBox[2] > drawerBox[0] && drawerBox[0] > paneBox[0] && drawerBox[0] < paneBox[2]) area[2] = drawerBox[0];
    const maxScroll = [pane.scrollWidth - pane.clientWidth, pane.scrollHeight - pane.clientHeight];
    const scroll = [pane.scrollLeft, pane.scrollTop];
    const centreOf = (box, axis) => (box[axis] + box[axis + 2]) / 2;
    const targetOf = (node, axis) => scroll[axis] + centreOf(read(node), axis) - centreOf(area, axis);
    const visibleNodes = () => [...document.querySelectorAll('#stage .node.n-snap')].filter((node) => node.offsetParent !== null);
`;

interface CentredView {
  node: number[];
  area: number[];
  pane: number[];
  drawer: number[];
  scroll: number[];
  maxScroll: number[];
  offset: number[];
  isInside: boolean;
  touchesDrawer: boolean;
}

const readView = (nodeSelector: string) => `(() => { ${DEFINE_MEASURE}
    const node = ${nodeSelector};
    const box = read(node);
    return { node: box, area, pane: paneBox, drawer: drawerBox, scroll, maxScroll,
        offset: [0, 1].map((axis) => centreOf(box, axis) - centreOf(area, axis)),
        isInside: box[0] >= paneBox[0] && box[1] >= paneBox[1] && box[2] <= paneBox[2] && box[3] <= paneBox[3],
        touchesDrawer: box[0] < drawerBox[2] && box[2] > drawerBox[0] && box[1] < drawerBox[3] && box[3] > drawerBox[1] };
})()`;

// Marks the first visible snapshot node whose centred target is inside (or, for the edge case, outside) the scroll range; returns -1 or -2 when none exists.
const markProbe = (wantInterior: boolean) => `(() => { ${DEFINE_MEASURE}
    document.querySelectorAll('[data-centre-probe]').forEach((node) => node.removeAttribute('data-centre-probe'));
    const isInterior = (node) => [0, 1].every((axis) => targetOf(node, axis) >= ${INTERIOR_MARGIN_PX} && targetOf(node, axis) <= maxScroll[axis] - ${INTERIOR_MARGIN_PX});
    const isClamped = (node) => [0, 1].some((axis) => targetOf(node, axis) < -${INTERIOR_MARGIN_PX} || targetOf(node, axis) > maxScroll[axis] + ${INTERIOR_MARGIN_PX});
    const found = visibleNodes().find(${wantInterior ? "isInterior" : "isClamped"});
    if (!found) return false;
    found.setAttribute('data-centre-probe', '1');
    window.__centreTargets = [0, 1].map((axis) => targetOf(found, axis));
    return true;
})()`;

const PROBE = `document.querySelector('[data-centre-probe]')`;

const centreLine = (label: string, view: CentredView): string =>
  `CENTRE ${label}: node centre (${(view.node[0]! + view.node[2]!) / 2}, ${(view.node[1]! + view.node[3]!) / 2}) area centre (${(view.area[0]! + view.area[2]!) / 2}, ${(view.area[1]! + view.area[3]!) / 2}) offset ${JSON.stringify(view.offset)} scroll ${JSON.stringify(view.scroll)} of ${JSON.stringify(view.maxScroll)} drawer ${JSON.stringify(view.drawer)} pane ${JSON.stringify(view.pane)}`;

async function zoomUntilNodeCanCentre(page: HeadlessPage): Promise<boolean> {
  for (let clicks = 0; clicks <= MAX_ZOOM_CLICKS; clicks++) {
    if (await page.evaluate<boolean>(markProbe(true))) {
      return true;
    }
    await page.evaluate(`document.getElementById('zoom-in').click()`);
    await pause(300);
  }
  return false;
}

async function checkInteriorNode(page: HeadlessPage): Promise<void> {
  const hasProbe = await zoomUntilNodeCanCentre(page);
  reportCheck("#drawer-centre a node exists whose centred scroll target is inside the scroll range", hasProbe);
  if (!hasProbe) {
    return;
  }
  await page.evaluate(`${PROBE}.click()`);
  await pause(400);
  const view = await page.evaluate<CentredView>(readView(PROBE));
  console.log(centreLine("node click", view));
  reportCheck("#drawer-centre the clicked node is fully inside the visible timeline", view.isInside, view);
  reportCheck("#drawer-centre the clicked node does not touch the drawer", !view.touchesDrawer, view);
  reportCheck("#drawer-centre the node centre is within 4px of the uncovered area centre on both axes",
    view.offset.every((offset) => Math.abs(offset) <= CENTRE_TOLERANCE_PX), view);
}

// An edge node cannot be centred: its target lies outside the scroll range, so the scroll must sit at that end.
async function checkEdgeNode(page: HeadlessPage): Promise<void> {
  const hasProbe = await page.evaluate<boolean>(markProbe(false));
  reportCheck("#drawer-centre a node exists whose centred scroll target is outside the scroll range", hasProbe);
  if (!hasProbe) {
    return;
  }
  const targets = await page.evaluate<number[]>(`window.__centreTargets`);
  await page.evaluate(`${PROBE}.click()`);
  await pause(400);
  const view = await page.evaluate<CentredView>(readView(PROBE));
  console.log(centreLine("edge node click", view));
  reportCheck("#drawer-centre the edge node is fully inside the visible timeline", view.isInside && !view.touchesDrawer, view);
  reportCheck("#drawer-centre each clamped axis sits exactly at its scroll end, each free axis is centred",
    [0, 1].every((axis) => {
      const target = targets[axis]!;
      if (target < 0) {
        return view.scroll[axis]! <= EDGE_TOLERANCE_PX;
      }
      if (target > view.maxScroll[axis]!) {
        return view.scroll[axis]! >= view.maxScroll[axis]! - EDGE_TOLERANCE_PX;
      }
      return Math.abs(view.offset[axis]!) <= CENTRE_TOLERANCE_PX;
    }), { targets, view });
}

async function checkDrawerNeverCoversPane(page: HeadlessPage): Promise<void> {
  const view = await page.evaluate<CentredView>(readView(`document.getElementById('stage')`));
  console.log(`CENTRE layout: pane ${JSON.stringify(view.pane)} drawer ${JSON.stringify(view.drawer)} uncovered area ${JSON.stringify(view.area)}`);
  reportCheck("#drawer-centre the drawer is a flex sibling: it never covers #timelines, so the uncovered area is the pane",
    view.drawer[0]! >= view.pane[2]! - EDGE_TOLERANCE_PX && view.area.every((edge, index) => edge === view.pane[index]), view);
}

// Landings from the middle of the pane: every axis not pinned at a scroll end must be centred, and at least one landing must have both axes free.
async function checkArrowLandings(page: HeadlessPage): Promise<void> {
  await page.evaluate(`(() => { const p = document.getElementById('timelines'); p.scrollTop = (p.scrollHeight - p.clientHeight) / 2; p.scrollLeft = (p.scrollWidth - p.clientWidth) / 2; })()`);
  await pause(300);
  const arrow = `document.querySelector('#show-row button[data-jump-kind="snapshot"][data-jump="next"]')`;
  const landings: CentredView[] = [];
  for (let clicks = 0; clicks < MAX_ARROW_CLICKS && !(await page.evaluate<boolean>(`${arrow}.disabled`)); clicks++) {
    await page.evaluate(`${arrow}.click()`);
    await pause(300);
    const view = await page.evaluate<CentredView>(readView(`document.querySelector('#stage .node.found')`));
    console.log(centreLine(`arrow landing ${clicks + 1}`, view));
    landings.push(view);
  }
  const isFree = (view: CentredView, axis: number): boolean =>
    view.scroll[axis]! > EDGE_TOLERANCE_PX && view.scroll[axis]! < view.maxScroll[axis]! - EDGE_TOLERANCE_PX;
  reportCheck("#drawer-centre the arrow landed at least once", landings.length > 0);
  reportCheck("#drawer-centre every arrow landing is inside the pane and clear of the drawer", landings.every((view) => view.isInside && !view.touchesDrawer), landings);
  reportCheck("#drawer-centre on every arrow landing each axis not pinned at a scroll end is centred within 4px",
    landings.every((view) => [0, 1].every((axis) => !isFree(view, axis) || Math.abs(view.offset[axis]!) <= CENTRE_TOLERANCE_PX)), landings);
  reportCheck("#drawer-centre at least one arrow landing was free on both axes (a true centring, not a clamp)",
    landings.some((view) => isFree(view, 0) && isFree(view, 1)), landings);
}

export async function validateCentring(page: HeadlessPage): Promise<void> {
  await checkInteriorNode(page);
  await checkEdgeNode(page);
  await checkDrawerNeverCoversPane(page);
  await checkArrowLandings(page);
  await page.evaluate(`document.getElementById('zoom-reset').click()`);
  await pause(300);
}

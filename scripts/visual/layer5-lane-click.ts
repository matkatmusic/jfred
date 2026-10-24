// Task 357: a branch lane node opens the Details drawer like a trunk edit node and ends up fully visible beside it.
//
// Boxes are [left, top, right, bottom]. TRAP: the probes are template literals, so no backtick or dollar-brace inside them.

import { pause, type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

const DRAWER_TIMEOUT_MS = 120_000;
const RECENTRE_WAIT_MS = 600;

export interface LaneClickOptions {
  // Only lane nodes in the bubble of this path; any bubble when absent.
  path?: string;
  // How many lane nodes to click, in document order.
  max: number;
  // Every clicked node's instant must fall in [from, to] (ISO strings).
  instantWindow?: [string, string];
}

interface ClickedLaneNode {
  head: string; meta: string; rows: number; changedText: number; instant: string;
  isShown: boolean; isInsidePane: boolean; touchesDrawer: boolean; drawerOpen: boolean;
}

const pickDot = (options: LaneClickOptions, index: number) => `(() => {
    document.querySelectorAll('[data-lane-click]').forEach((node) => node.removeAttribute('data-lane-click'));
    const boxes = [...document.querySelectorAll('.filebox')].filter((box) => ${options.path === undefined ? "true" : `box.querySelector('.fname')?.dataset.path === ${JSON.stringify(options.path)}`});
    const dots = boxes.flatMap((box) => [...box.querySelectorAll('.bnode')]).filter((node) => node.offsetParent !== null);
    const dot = dots[${index}];
    if (!dot) return -1;
    dot.setAttribute('data-lane-click', '1');
    return dots.length;
})()`;

const CLICK_DOT = `(() => { document.getElementById('dbody').replaceChildren(); document.querySelector('[data-lane-click]').click(); })()`;

const READ_CLICKED = `(() => {
    const read = (element) => { const r = element.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
    const node = document.querySelector('[data-lane-click]');
    const box = read(node);
    const paneBox = read(document.getElementById('timelines'));
    const drawerBox = read(document.getElementById('drawer'));
    const lines = [...document.querySelectorAll('#dbody .diff-line')];
    return {
        head: document.getElementById('dpath').textContent,
        meta: document.getElementById('dmeta').textContent,
        rows: lines.length,
        changedText: lines.map((line) => line.textContent.trim()).join('').length,
        instant: node.dataset.instant,
        isShown: node.offsetParent !== null && getComputedStyle(node).visibility !== 'hidden',
        isInsidePane: box[0] >= paneBox[0] && box[1] >= paneBox[1] && box[2] <= paneBox[2] && box[3] <= paneBox[3],
        touchesDrawer: box[0] < drawerBox[2] && box[2] > drawerBox[0] && box[1] < drawerBox[3] && box[3] > drawerBox[1],
        drawerOpen: document.getElementById('drawer').classList.contains('open') };
})()`;

export async function checkLaneNodeClicks(page: HeadlessPage, tag: string, options: LaneClickOptions): Promise<void> {
  let clicked = 0;
  for (let index = 0; index < options.max; index += 1) {
    const dotCount = await page.evaluate<number>(pickDot(options, index));
    if (dotCount < 0) {
      break;
    }
    await page.evaluate(CLICK_DOT);
    await page.waitFor(`document.getElementById('drawer').classList.contains('open') && document.querySelectorAll('#dbody .diff-line').length > 0`, DRAWER_TIMEOUT_MS);
    await pause(RECENTRE_WAIT_MS);
    const facts = await page.evaluate<ClickedLaneNode>(READ_CLICKED);
    const label = `${tag} lane node ${index + 1}/${dotCount}`;
    reportCheck(`${tag} clicking ${label} opens the drawer, headed '<file> <label>', named as a branch revision`,
      facts.drawerOpen && /^\S+ \S/.test(facts.head) && facts.meta.startsWith("branch revision · "), [facts.head, facts.meta]);
    reportCheck(`${tag} ${label}: the diff shows a non-empty before or after`, facts.rows > 0 && facts.changedText > 0, { rows: facts.rows, changedText: facts.changedText });
    reportCheck(`${tag} ${label}: the node is shown, inside the pane and clear of the drawer`,
      facts.isShown && facts.isInsidePane && !facts.touchesDrawer, facts);
    if (options.instantWindow !== undefined) {
      const [from, to] = options.instantWindow;
      reportCheck(`${tag} ${label}: its instant ${facts.instant} falls in ${from}..${to}`,
        Date.parse(facts.instant) >= Date.parse(from) && Date.parse(facts.instant) <= Date.parse(to), facts.instant);
    }
    clicked += 1;
  }
  reportCheck(`${tag} at least one lane node was clicked`, clicked > 0, clicked);
  await page.evaluate(`document.getElementById('dclose').click()`);
}

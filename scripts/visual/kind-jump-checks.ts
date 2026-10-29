// Show-row kind-jump arrows on the fixture-mode page; mockup.ts calls validateKindJump and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const SCRIPT_BOX = `document.querySelector('#show-row input[data-kind="script-run"]')`;
const SCRIPT_DOTS = `document.querySelectorAll('#stage i.node.n-script')`;
const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
const LOAD_TIMEOUT_MS = 15_000;
// One run cannot take more steps than this, so a higher count means the arrows never end.
const MAX_STEPS = 20;

const selectArrow = (direction: "previous" | "next") =>
  `document.querySelector('#show-row button[data-jump-kind="script-run"][data-jump="${direction}"]')`;

interface Landed {
  isScript: boolean;
  onScreen: boolean;
  isCentred: boolean;
  flashed: boolean;
  y: number;
  boxChecked: boolean;
}

const READ_LANDED = `(() => {
    const node = document.querySelector('#stage i.node.found');
    if (!node) return null;
    const scroller = document.getElementById('timelines');
    const pane = scroller.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
        isScript: node.classList.contains('n-script'),
        onScreen: box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1 && box.left >= pane.left - 1 && box.right <= pane.right + 1,
        isCentred: (Math.abs((box.left + box.right) / 2 - (pane.left + pane.right) / 2) <= 4 || scroller.scrollLeft <= 1 || scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1)
            && (Math.abs((box.top + box.bottom) / 2 - (pane.top + pane.bottom) / 2) <= 4 || scroller.scrollTop <= 1 || scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1),
        flashed: document.querySelectorAll('#stage i.node.found').length === 1,
        y: box.top + box.height / 2,
        boxChecked: ${SCRIPT_BOX}.checked };
})()`;

async function triggerArrow(page: HeadlessPage, direction: "previous" | "next"): Promise<Landed | null> {
  await page.evaluate(`${selectArrow(direction)}.click()`);
  return page.evaluate<Landed | null>(READ_LANDED);
}

function isEveryTrue(values: boolean[]): boolean {
  for (const value of values) {
    if (!value) {
      return false;
    }
  }
  return true;
}

async function validateDisabledBeforeTick(page: HeadlessPage): Promise<void> {
  const disabled = await page.evaluate<boolean[]>(`[${selectArrow("previous")}, ${selectArrow("next")}].map(a => a.disabled)`);
  reportCheck("KJ before the box is ticked: both script-run arrows are disabled", disabled.length === 2 && isEveryTrue(disabled), disabled);
}

async function validateStepsForward(page: HeadlessPage): Promise<Landed[]> {
  await page.evaluate(`${SCRIPT_BOX}.click()`);
  await page.waitFor(`${SCRIPT_DOTS}.length > 0 && ${STRIP_IDLE}`, LOAD_TIMEOUT_MS);
  await page.evaluate(`document.getElementById('timelines').scrollTop = 0`);
  // A node at the pane's centre counts as landed, so start from the first node.
  for (let step = 0; step < MAX_STEPS; step++) {
    const isAtFirstNode = await page.evaluate<boolean>(`${selectArrow("previous")}.disabled`);
    if (isAtFirstNode) {
      break;
    }
    await triggerArrow(page, "previous");
  }
  const visited: Landed[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const isAtLastNode = await page.evaluate<boolean>(`${selectArrow("next")}.disabled`);
    if (isAtLastNode) {
      break;
    }
    const landed = await triggerArrow(page, "next");
    if (landed === null) {
      break;
    }
    visited.push(landed);
  }
  let isEveryLandingScript = true;
  let isEveryLandingCentred = true;
  let isEveryBoxChecked = true;
  for (const landed of visited) {
    const isScriptOnScreenFlashed = landed.isScript && landed.onScreen && landed.flashed;
    if (!isScriptOnScreenFlashed) {
      isEveryLandingScript = false;
    }
    if (!landed.isCentred) {
      isEveryLandingCentred = false;
    }
    if (!landed.boxChecked) {
      isEveryBoxChecked = false;
    }
  }
  reportCheck("KJ > lands at least once, then ends with > disabled", visited.length > 0 && await page.evaluate<boolean>(`${selectArrow("next")}.disabled`), visited.length);
  reportCheck("KJ every > landing is a script node, on screen and flashed", isEveryLandingScript, visited);
  reportCheck("KJ every > landing is centred in the visible timeline (or its scroll is clamped)", isEveryLandingCentred, visited);
  reportCheck("KJ clicking > never toggled the script-run box", isEveryBoxChecked, visited);
  await saveScreenshot(page, "09-kind-jump-next");
  return visited;
}

async function validateStepsBack(page: HeadlessPage, visited: Landed[]): Promise<void> {
  const before = visited[visited.length - 2];
  const landed = await triggerArrow(page, "previous");
  reportCheck("KJ < lands on a script node, on screen and flashed", landed !== null && landed.isScript && landed.onScreen && landed.flashed, landed);
  reportCheck("KJ < goes back to the node before the last one that > reached",
    before === undefined || (landed !== null && Math.abs(landed.y - before.y) <= 1), { landed, before });
}

async function validateDisabledAfterUntick(page: HeadlessPage): Promise<void> {
  await page.evaluate(`${SCRIPT_BOX}.click()`);
  const disabled = await page.evaluate<boolean[]>(`[${selectArrow("previous")}, ${selectArrow("next")}].map(a => a.disabled)`);
  reportCheck("KJ after the box is unticked: both script-run arrows are disabled", disabled.length === 2 && isEveryTrue(disabled), disabled);
}

export async function validateKindJump(page: HeadlessPage, pageUrl: string): Promise<void> {
  await validateDisabledBeforeTick(page);
  const visited = await validateStepsForward(page);
  await validateStepsBack(page, visited);
  await validateDisabledAfterUntick(page);
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

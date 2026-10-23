// Show-row kind-jump arrows on the fixture-mode page; mockup.ts calls checkKindJump and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const SCRIPT_BOX = `document.querySelector('#show-row input[data-kind="script-run"]')`;
const SCRIPT_DOTS = `document.querySelectorAll('#stage i.node.n-script')`;
const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
const LOAD_TIMEOUT_MS = 15_000;
// A node cannot sit between two clicks of one run, so more steps than this means the arrows never end.
const MAX_STEPS = 20;

const arrow = (direction: "previous" | "next") =>
  `document.querySelector('#show-row button[data-jump-kind="script-run"][data-jump="${direction}"]')`;

interface Landed {
  isScript: boolean;
  onScreen: boolean;
  flashed: boolean;
  y: number;
  boxChecked: boolean;
}

const READ_LANDED = `(() => {
    const node = document.querySelector('#stage i.node.found');
    if (!node) return null;
    const pane = document.getElementById('timelines').getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return {
        isScript: node.classList.contains('n-script'),
        onScreen: box.top >= pane.top - 1 && box.bottom <= pane.bottom + 1 && box.left >= pane.left - 1 && box.right <= pane.right + 1,
        flashed: document.querySelectorAll('#stage i.node.found').length === 1,
        y: box.top + box.height / 2,
        boxChecked: ${SCRIPT_BOX}.checked };
})()`;

async function clickArrow(page: HeadlessPage, direction: "previous" | "next"): Promise<Landed | null> {
  await page.evaluate(`${arrow(direction)}.click()`);
  return page.evaluate<Landed | null>(READ_LANDED);
}

async function checkDisabledBeforeTick(page: HeadlessPage): Promise<void> {
  const disabled = await page.evaluate<boolean[]>(`[${arrow("previous")}, ${arrow("next")}].map(a => a.disabled)`);
  reportCheck("KJ before the box is ticked: both script-run arrows are disabled", disabled.length === 2 && disabled.every(Boolean), disabled);
}

async function checkStepsForward(page: HeadlessPage): Promise<Landed[]> {
  await page.evaluate(`${SCRIPT_BOX}.click()`);
  await page.waitFor(`${SCRIPT_DOTS}.length > 0 && ${STRIP_IDLE}`, LOAD_TIMEOUT_MS);
  await page.evaluate(`document.getElementById('timelines').scrollTop = 0`);
  const visited: Landed[] = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    if (await page.evaluate<boolean>(`${arrow("next")}.disabled`)) {
      break;
    }
    const landed = await clickArrow(page, "next");
    if (landed === null) {
      break;
    }
    visited.push(landed);
  }
  reportCheck("KJ > lands at least once, then ends with > disabled", visited.length > 0 && await page.evaluate<boolean>(`${arrow("next")}.disabled`), visited.length);
  reportCheck("KJ every > landing is a script node, on screen and flashed",
    visited.every((landed) => landed.isScript && landed.onScreen && landed.flashed), visited);
  reportCheck("KJ clicking > never toggled the script-run box", visited.every((landed) => landed.boxChecked), visited);
  await saveScreenshot(page, "09-kind-jump-next");
  return visited;
}

async function checkStepsBack(page: HeadlessPage, visited: Landed[]): Promise<void> {
  const before = visited[visited.length - 2];
  const landed = await clickArrow(page, "previous");
  reportCheck("KJ < lands on a script node, on screen and flashed", landed !== null && landed.isScript && landed.onScreen && landed.flashed, landed);
  reportCheck("KJ < goes back to the node before the last one that > reached",
    before === undefined || (landed !== null && Math.abs(landed.y - before.y) <= 1), { landed, before });
}

async function checkDisabledAfterUntick(page: HeadlessPage): Promise<void> {
  await page.evaluate(`${SCRIPT_BOX}.click()`);
  const disabled = await page.evaluate<boolean[]>(`[${arrow("previous")}, ${arrow("next")}].map(a => a.disabled)`);
  reportCheck("KJ after the box is unticked: both script-run arrows are disabled", disabled.length === 2 && disabled.every(Boolean), disabled);
}

export async function checkKindJump(page: HeadlessPage, pageUrl: string): Promise<void> {
  await checkDisabledBeforeTick(page);
  const visited = await checkStepsForward(page);
  await checkStepsBack(page, visited);
  await checkDisabledAfterUntick(page);
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

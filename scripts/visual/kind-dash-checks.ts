// Ruler kind dashes on the fixture-mode page; mockup.ts calls validateKindDashes and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const SCRIPT_DOTS = `document.querySelectorAll('#stage i.node.n-script')`;
const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
const LOAD_TIMEOUT_MS = 15_000;
const selectKindBox = (kind: string) => `document.querySelector('#show-row input[data-kind="${kind}"]')`;
const countDashes = (kindClass: string) => `document.querySelectorAll('#ruler .tick .kdash-${kindClass}').length`;

interface DashProbe {
  title: string;
  width: number;
  height: number;
  visible: boolean;
}

const READ_FIRST_DASH = `(() => {
    const dash = document.querySelector('#ruler .tick .kind-dashes:has(> .kdash:only-child) > .kdash');
    const rect = dash.getBoundingClientRect();
    const style = getComputedStyle(dash);
    return { title: dash.title, width: rect.width, height: rect.height,
        visible: style.display !== 'none' && style.visibility !== 'hidden' && style.backgroundColor !== 'rgba(0, 0, 0, 0)' };
})()`;

async function validateDashesDrawn(page: HeadlessPage): Promise<void> {
  const total = await page.evaluate<number>(`document.querySelectorAll('#ruler .tick .kdash').length`);
  reportCheck("KD ticks show dashes", total > 0, total);
  const mixedMulti = await page.evaluate<number>(
    `[...document.querySelectorAll('#ruler .tick.multi')].filter(t => t.querySelectorAll('.kdash').length > 1).length`);
  reportCheck("KD a .tick.multi with mixed kinds shows more than 1 dash", mixedMulti > 0, mixedMulti);
  const dash = await page.evaluate<DashProbe>(READ_FIRST_DASH);
  reportCheck("KD a dash has a non-empty title", dash.title !== "", dash);
  reportCheck("KD a dash measures about 12x4 px and is visible",
    dash.visible && Math.abs(dash.width - 12) <= 1 && Math.abs(dash.height - 4) <= 1, dash);
  const stray = await page.evaluate<number>(
    `[...document.querySelectorAll('#ruler .tick')].filter(t => t.querySelectorAll('.kind-dashes').length !== 1).length`);
  reportCheck("KD every tick holds exactly one dash container", stray === 0, stray);
  const pastRail = await page.evaluate<number[]>(
    `(() => { const rail = document.querySelector('#ruler .rail').getBoundingClientRect().left;
      return [...document.querySelectorAll('#ruler .tick .kind-dashes')].map(d => d.getBoundingClientRect().right - rail).filter(over => over > 0); })()`);
  reportCheck("KD no dash container reaches past the ruler rail", pastRail.length === 0, pastRail);
  await saveScreenshot(page, "10-kind-dashes");
}

async function validateScriptDashAppears(page: HeadlessPage): Promise<void> {
  const before = await page.evaluate<number>(countDashes("script-run"));
  await page.evaluate(`${selectKindBox("script-run")}.click()`);
  await page.waitFor(`${SCRIPT_DOTS}.length > 0 && ${STRIP_IDLE}`, LOAD_TIMEOUT_MS);
  const after = await page.evaluate<number>(countDashes("script-run"));
  reportCheck("KD ticking the Script box gives some tick a script dash", before === 0 && after > 0, { before, after });
  await saveScreenshot(page, "11-kind-dashes-script");
}

async function validateUntickRemovesDashes(page: HeadlessPage): Promise<void> {
  for (const [kind, kindClass] of [["script-run", "script-run"], ["commit", "commit"]]) {
    await page.evaluate(`${selectKindBox(kind!)}.click()`);
    const left = await page.evaluate<number>(countDashes(kindClass!));
    reportCheck(`KD unticking ${kind} removes its dashes`, left === 0, left);
  }
}

export async function validateKindDashes(page: HeadlessPage, pageUrl: string): Promise<void> {
  await validateDashesDrawn(page);
  await validateScriptDashAppears(page);
  await validateUntickRemovesDashes(page);
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

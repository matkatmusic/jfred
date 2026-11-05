// Layer 6 page steps shared by the consent, popup, outcome, clear and blocked checks.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { COUNT_SCRIPT_DOTS, STRIP_IDLE } from "./layer4-probes.ts";
import {
  CLICK_OPEN_BUTTON, CONSOLE_FINISHED, OPEN_BUTTON_PRESENT, PAGE_SPY_INSTALL, READ_FETCH_LOG, RESET_DRAWER, buildNodeExpression,
  buildRunPostProbe, buildScrollToDot,
} from "./layer6-probes.ts";

export const WAIT_MS = 15_000;
export const DEBOUNCE_WAIT_MS = 400;
const RUN_ROUTE = "/api/layer1-script-run";
const CLEAR_ROUTE = "/api/layer1-clear-results";

export interface FetchEntry { path: string; body: string }

export async function openFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
  await page.evaluate(PAGE_SPY_INSTALL);
}

export async function openScriptLayer(page: HeadlessPage): Promise<void> {
  await page.evaluate(`document.getElementById('layer-4').click()`);
  await page.waitFor(`${COUNT_SCRIPT_DOTS} > 0 && ${STRIP_IDLE}`, WAIT_MS);
}

export async function moveToDot(page: HeadlessPage, toolUseId: string): Promise<void> {
  await page.evaluate(buildScrollToDot(toolUseId));
}

export async function waitForRunPost(page: HeadlessPage, toolUseId: string): Promise<void> {
  await page.waitFor(buildRunPostProbe(toolUseId), WAIT_MS);
}

export async function waitForRunFinished(page: HeadlessPage): Promise<void> {
  await page.waitFor(CONSOLE_FINISHED, WAIT_MS);
}

// The run must have started: the drawer shows the console button only for a started run.
export async function openRunConsole(page: HeadlessPage, toolUseId: string): Promise<void> {
  await page.evaluate(`${RESET_DRAWER}; ${buildNodeExpression(toolUseId)}.click()`);
  await page.waitFor(OPEN_BUTTON_PRESENT, WAIT_MS);
  await page.evaluate(CLICK_OPEN_BUTTON);
}

export function waitForDebounce(): Promise<void> {
  return waitMilliseconds(DEBOUNCE_WAIT_MS);
}

export function listRunPostIds(log: FetchEntry[]): string[] {
  const ids: string[] = [];
  for (const entry of log) {
    const isRunPost = entry.path === RUN_ROUTE;
    if (isRunPost)
      ids.push((JSON.parse(entry.body) as { toolUseId: string }).toolUseId);
  }
  return ids;
}

export function countClearPosts(log: FetchEntry[]): number {
  let count = 0;
  for (const entry of log) {
    const isClearPost = entry.path === CLEAR_ROUTE;
    if (isClearPost)
      count += 1;
  }
  return count;
}

export async function readRunPostIds(page: HeadlessPage): Promise<string[]> {
  return listRunPostIds(await page.evaluate<FetchEntry[]>(READ_FETCH_LOG));
}

export async function readClearPostCount(page: HeadlessPage): Promise<number> {
  return countClearPosts(await page.evaluate<FetchEntry[]>(READ_FETCH_LOG));
}

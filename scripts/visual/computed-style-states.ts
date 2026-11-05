// The page states the computed-style proof records, driven with the steps the other visual scripts already use.

import type { HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { COUNT_EDIT_DOTS, EDIT_BOX, UTIL_PATH, buildDotFinder } from "./layer3-probes.ts";
import { CLICK_RUN_SCRIPTS, CONSOLE_FINISHED, CONSENT_FACTS, PENDING_ID, RESET_DRAWER, buildDotClasses, buildNodeExpression } from "./layer6-probes.ts";
import { moveToDot, openFreshPage, openRunConsole, openScriptLayer } from "./layer6-steps.ts";
import { openSessionColumn } from "./layer7-probes.ts";
import { COMMIT_MODE_CLICK, STRIP_COUNT } from "./layer9-probes.ts";
import { READY_EXPRESSION, VISUAL_STATES } from "./states.ts";

export type RecordState = (name: string) => Promise<void>;

const WAIT_MS = 120_000;
const CLEAR_THEME = `delete document.documentElement.dataset.theme`;
const OPEN_ALL_FOLDERS = `document.querySelectorAll('#filenav-tree details').forEach((folder) => { folder.open = true; })`;
const CLICK_FIRST_SESSION = `document.querySelector('.session-item').click()`;
const DRAWER_ON_EDIT = `document.getElementById('drawer').classList.contains('open') && document.querySelectorAll('#dbody .diff-line').length > 0`;
const DRAWER_ON_SCRIPT = `document.getElementById('drawer').classList.contains('open') && document.querySelector('#drawer .scriptbody pre')?.textContent.length > 0`;

export function buildSetThemeExpression(theme: string): string {
  return `document.documentElement.dataset.theme = '${theme}'`;
}

export function buildClickElementExpression(id: string): string {
  return `document.getElementById('${id}').click()`;
}

async function loadPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`${READY_EXPRESSION} && ${STRIP_IDLE}`, WAIT_MS);
}

async function executeVisualStates(page: HeadlessPage, prefix: string, recordState: RecordState): Promise<void> {
  for (const state of VISUAL_STATES) {
    await state.drive(page);
    await recordState(`${prefix}/${state.name}`);
  }
}

async function executeThemeStates(page: HeadlessPage, prefix: string, recordState: RecordState): Promise<void> {
  await page.evaluate(buildSetThemeExpression("dark"));
  await recordState(`${prefix}/theme-dark`);
  await page.evaluate(buildSetThemeExpression("light"));
  await recordState(`${prefix}/theme-light`);
  await page.evaluate(CLEAR_THEME);
}

async function executeColumnStates(page: HeadlessPage, prefix: string, recordState: RecordState): Promise<void> {
  await openSessionColumn(page);
  await recordState(`${prefix}/session-column-annotation-track-on`);
}

async function executeNavStates(page: HeadlessPage, recordState: RecordState): Promise<void> {
  await page.evaluate(OPEN_ALL_FOLDERS);
  await recordState("fixture/filenav-all-folders-open");
  await page.evaluate(CLICK_FIRST_SESSION);
  await page.waitFor(`document.querySelectorAll('.range').length > 0 && ${STRIP_IDLE}`, WAIT_MS);
  await recordState("fixture/jsonls-nav-session-selected");
  await page.evaluate(buildClickElementExpression("clear-sessions"));
  await page.waitFor(`document.querySelectorAll('.range').length === 0 && ${STRIP_IDLE}`, WAIT_MS);
}

async function executeFixtureShellStates(page: HeadlessPage, pageUrl: string, recordState: RecordState): Promise<void> {
  await loadPage(page, pageUrl);
  await executeThemeStates(page, "fixture", recordState);
  await executeNavStates(page, recordState);
  await executeColumnStates(page, "fixture", recordState);
  await page.evaluate(COMMIT_MODE_CLICK);
  await page.waitFor(`${STRIP_COUNT} > 0`, WAIT_MS);
  await recordState("fixture/commits-column-on");
}

async function executeEditDrawerState(page: HeadlessPage, recordState: RecordState): Promise<void> {
  await page.evaluate(`${EDIT_BOX}.click()`);
  await page.waitFor(`${COUNT_EDIT_DOTS} > 0 && ${STRIP_IDLE}`, WAIT_MS);
  await page.evaluate(`${buildDotFinder(UTIL_PATH, "n-edit")}.click()`);
  await page.waitFor(DRAWER_ON_EDIT, WAIT_MS);
  await recordState("fixture/drawer-open-on-edit");
  await page.evaluate(buildClickElementExpression("dclose"));
}

async function executeScriptDrawerStates(page: HeadlessPage, recordState: RecordState): Promise<void> {
  await openScriptLayer(page);
  await moveToDot(page, PENDING_ID);
  await page.evaluate(`${RESET_DRAWER}; ${buildNodeExpression(PENDING_ID)}.click()`);
  await page.waitFor(`(${CONSENT_FACTS}).count === 1`, WAIT_MS);
  await recordState("fixture/popup-open-run-consent");
  await page.waitFor(DRAWER_ON_SCRIPT, WAIT_MS);
  await recordState("fixture/drawer-open-on-script-run");
}

async function executeRunConsoleState(page: HeadlessPage, recordState: RecordState): Promise<void> {
  await page.evaluate(CLICK_RUN_SCRIPTS);
  await page.waitFor(`${buildDotClasses(PENDING_ID)}.includes('run-state-verified')`, WAIT_MS);
  await openRunConsole(page, PENDING_ID);
  await page.waitFor(CONSOLE_FINISHED, WAIT_MS);
  await recordState("fixture/popup-open-run-console");
}

async function executeFixtureDrawerStates(page: HeadlessPage, pageUrl: string, recordState: RecordState): Promise<void> {
  await openFreshPage(page, pageUrl);
  await executeEditDrawerState(page, recordState);
  await executeScriptDrawerStates(page, recordState);
  await executeRunConsoleState(page, recordState);
}

export async function executeFixtureStates(page: HeadlessPage, pageUrl: string, recordState: RecordState): Promise<void> {
  await loadPage(page, pageUrl);
  await executeVisualStates(page, "fixture", recordState);
  await executeFixtureShellStates(page, pageUrl, recordState);
  await executeFixtureDrawerStates(page, pageUrl, recordState);
}

export async function executeRealStates(page: HeadlessPage, pageUrl: string, recordState: RecordState): Promise<void> {
  await loadPage(page, pageUrl);
  await executeVisualStates(page, "real", recordState);
  await executeThemeStates(page, "real", recordState);
}

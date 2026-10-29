// Task 343: S20's Verify list on the fixture-mode page; mockup.ts calls executeLayer3Checks and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { assertDerivedEdit, assertReadBeacon, assertVerifiedEdit } from "./layer3-drawer-checks.ts";
import {
  COUNT_EDIT_DOTS, COUNT_EDIT_REQUESTS, COUNT_TICKS, DISPATCHER_PATH, EDIT_BOX, INDEX_PATH, STRIP_IDLE, UTIL_PATH, WATCH_STRIP,
  buildDotFinder, buildRowsProbe, buildRulerMatchProbe, buildToggleProbe, buildTokenColour,
} from "./layer3-probes.ts";

const README_PATH = "README.md";

export function isNonEmptyAllEqual(texts: string[], expected: string): boolean {
  let isAllEqual = texts.length > 0;
  for (const text of texts) {
    if (text !== expected)
      isAllEqual = false;
  }
  return isAllEqual;
}

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

// Runs `trigger`, waits out the fetch and the redraw, then reports the strip, the one request and the box.
async function assertFirstFetch(page: HeadlessPage, label: string, trigger: string): Promise<number> {
  await page.evaluate(WATCH_STRIP);
  const ticksBefore = await page.evaluate<number>(COUNT_TICKS);
  await page.evaluate(trigger);
  await page.waitFor(`${COUNT_EDIT_DOTS} > 0 && ${STRIP_IDLE}`, 15_000);
  reportCheck(`#343 ${label}: the progress strip shows during the fetch`,
    await page.evaluate<boolean>(`window.__stripShown`));
  const requests = await page.evaluate<number>(COUNT_EDIT_REQUESTS);
  reportCheck(`#343 ${label}: exactly one /api/layer1-edits request`, requests === 1, requests);
  reportCheck(`#343 ${label}: the Edit box reads checked`, await page.evaluate<boolean>(`${EDIT_BOX}.checked`));
  return ticksBefore;
}

async function assertBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("#343 before the box: no Edit or Read node is drawn",
    await page.evaluate<number>(COUNT_EDIT_DOTS) === 0);
  reportCheck("#343 before the box: the Edit box exists and is unchecked",
    await page.evaluate<boolean>(`${EDIT_BOX} !== null && ${EDIT_BOX}.checked === false`));
  reportCheck("#343 before the box: no /api/layer1-edits request yet",
    await page.evaluate<number>(COUNT_EDIT_REQUESTS) === 0);
}

async function assertRuler(page: HeadlessPage, ticksBefore: number): Promise<void> {
  const ticksAfter = await page.evaluate<number>(COUNT_TICKS);
  reportCheck("#343 the ruler grew to include the new instants", ticksAfter > ticksBefore, { ticksBefore, ticksAfter });
  const crafted: [string, string, string][] = [
    [UTIL_PATH, "06-01 14:15:00", "n-edit"],
    [DISPATCHER_PATH, "06-03 09:10:00", "n-edit"],
    [INDEX_PATH, "06-01 08:46:00", "n-read"],
  ];
  for (const [path, tickText, dotClass] of crafted) {
    reportCheck(`#343 the ruler holds ${tickText} level with the ${dotClass} node in ${path.split("/").pop()}`,
      await page.evaluate<boolean>(buildRulerMatchProbe(buildDotFinder(path, dotClass), tickText)));
  }
}

async function assertInstantToggle(page: HeadlessPage): Promise<void> {
  const toggled = await page.evaluate<{ afterUntick: boolean; afterTick: boolean; afterSecondUntick: boolean }>(
    buildToggleProbe(buildDotFinder(UTIL_PATH, "n-edit")));
  reportCheck("#343 untick hides Edit nodes, tick shows them, in one synchronous run",
    !toggled.afterUntick && toggled.afterTick && !toggled.afterSecondUntick, toggled);
  reportCheck("#343 toggling afterwards adds no request",
    await page.evaluate<number>(COUNT_EDIT_REQUESTS) === 1);
}

async function assertNodeLook(page: HeadlessPage): Promise<void> {
  const labels = await page.evaluate<{ edit: string[]; read: string[] }>(`({
        edit: [...document.querySelectorAll('i.node.n-edit + .nlabel')].map(l => l.textContent),
        read: [...document.querySelectorAll('i.node.n-read + .nlabel')].map(l => l.textContent) })`);
  reportCheck("#343 every Edit node reads [e]", isNonEmptyAllEqual(labels.edit, "[e]"), labels.edit.slice(0, 3));
  reportCheck("#343 every Read beacon reads [R]✓", isNonEmptyAllEqual(labels.read, "[R]✓"), labels.read.slice(0, 3));
  const colours = await page.evaluate<{ edit: string; read: string; editToken: string; readToken: string }>(`({
        edit: getComputedStyle(${buildDotFinder(UTIL_PATH, "n-edit")}).backgroundColor,
        read: getComputedStyle(${buildDotFinder(UTIL_PATH, "n-read")}).backgroundColor,
        editToken: ${buildTokenColour("--c-edit")}, readToken: ${buildTokenColour("--c-read")} })`);
  reportCheck("#343 Edit and Read dots use the Edit and Read token colours",
    colours.edit === colours.editToken && colours.read === colours.readToken && colours.edit !== colours.read, colours);
}

export async function executeLayer3Checks(page: HeadlessPage, pageUrl: string): Promise<void> {
  await assertBeforeTick(page);
  const readmeBefore = await page.evaluate<string>(buildRowsProbe(README_PATH));
  const ticksBefore = await assertFirstFetch(page, "ticking the Edit box", `${EDIT_BOX}.click()`);
  await assertRuler(page, ticksBefore);
  reportCheck("#343 a pair with no Layer 3 events renders as before",
    await page.evaluate<string>(buildRowsProbe(README_PATH)) === readmeBefore, readmeBefore);
  await assertInstantToggle(page);

  await waitForFreshPage(page, pageUrl);
  await assertFirstFetch(page, "the [3] button", `document.getElementById('layer-3').click()`);
  await assertNodeLook(page);
  await saveScreenshot(page, "05-layer3-on");
  await assertVerifiedEdit(page);
  await assertDerivedEdit(page);
  await assertReadBeacon(page);

  await waitForFreshPage(page, pageUrl);
}

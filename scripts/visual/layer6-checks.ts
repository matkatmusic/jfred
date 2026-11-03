// Layer 6 checks on the fixture-mode page; mockup.ts calls validateLayer6 and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { COUNT_SCRIPT_DOTS, STRIP_IDLE } from "./layer4-probes.ts";
import {
  BUTTON_FACTS, CLICK_CLOSE, CLICK_OPEN_BUTTON, CLOSE_LABEL, COUNT_CONSOLES, COUNT_CONSOLE_BUTTONS, MISMATCH_ID, NEVER_PROVABLE_ID,
  PENDING_ID, POPUP_FACTS, buildNodeExpression, type ButtonFacts, type PopupFacts,
} from "./layer6-probes.ts";
import { validateNodeStates } from "./layer6-node-checks.ts";
import { validatePopup } from "./layer6-popup-checks.ts";

const WAIT_MS = 15_000;
const DRAWER_SETTLED = `document.getElementById('drawer').classList.contains('open')
    && document.querySelector('#drawer .scriptbody pre')?.textContent.length > 0
    && document.querySelectorAll('#dbody details.dfile').length > 0`;

async function openNodeDrawer(page: HeadlessPage, toolUseId: string): Promise<void> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren();
        document.getElementById('drawer').classList.remove('open');
        ${buildNodeExpression(toolUseId)}.click()`);
  await page.waitFor(DRAWER_SETTLED, WAIT_MS);
}

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

async function validateNoButtonFor(page: HeadlessPage, toolUseId: string, name: string): Promise<void> {
  await openNodeDrawer(page, toolUseId);
  const count = await page.evaluate<number>(COUNT_CONSOLE_BUTTONS);
  reportCheck(`L6 the ${name} node opens the drawer with no Open run console button`, count === 0, count);
}

async function validateMismatchButton(page: HeadlessPage): Promise<void> {
  await openNodeDrawer(page, MISMATCH_ID);
  const button = await page.evaluate<ButtonFacts>(BUTTON_FACTS);
  const isButtonRight = button.count === 1 && button.text === "Open run console" && button.insideDrawer;
  reportCheck("L6 the mismatch node shows one Open run console button, inside the drawer", isButtonRight, button);
}

async function validateClose(page: HeadlessPage): Promise<void> {
  const closeLabel = await page.evaluate<string>(CLOSE_LABEL);
  await page.evaluate(CLICK_CLOSE);
  const closed = await page.evaluate<PopupFacts>(POPUP_FACTS);
  const isClosedRight = closeLabel === "Close" && closed.hidden && closed.drawerOpen;
  reportCheck("L6 Close hides the popup and leaves the drawer open", isClosedRight, closed);
  await page.evaluate(CLICK_OPEN_BUTTON);
  const reopened = await page.evaluate<PopupFacts>(POPUP_FACTS);
  const consoleCount = await page.evaluate<number>(COUNT_CONSOLES);
  reportCheck("L6 Open run console again shows the same single popup", consoleCount === 1 && !reopened.hidden, reopened);
}

export async function validateLayer6(page: HeadlessPage, pageUrl: string): Promise<void> {
  await waitForFreshPage(page, pageUrl);
  await page.evaluate(`document.getElementById('layer-4').click()`);
  await page.waitFor(`${COUNT_SCRIPT_DOTS} === 10 && ${STRIP_IDLE}`, WAIT_MS);
  const nodes = await validateNodeStates(page);
  await validateNoButtonFor(page, PENDING_ID, "pending");
  await validateNoButtonFor(page, NEVER_PROVABLE_ID, "never-provable");
  await validateMismatchButton(page);
  await validatePopup(page, nodes);
  await validateClose(page);
  await waitForFreshPage(page, pageUrl);
}

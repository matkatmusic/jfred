// Layer 6 checks on the fixture-mode page; mockup.ts calls validateLayer6 and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { COUNT_SCRIPT_DOTS } from "./layer4-probes.ts";
import {
  BUTTON_FACTS, CLICK_CLOSE, CLICK_OPEN_BUTTON, CLICK_RUN_SCRIPTS, CLOSE_LABEL, CONSENT_FACTS, COUNT_CONSOLES, COUNT_CONSOLE_BUTTONS,
  NEVER_PROVABLE_ID, PENDING_ID, POPUP_FACTS, buildDotClasses, buildNodeExpression, type ButtonFacts, type PopupFacts,
} from "./layer6-probes.ts";
import { validateBlocked } from "./layer6-blocked-checks.ts";
import { validateClear } from "./layer6-clear-checks.ts";
import { validateNodeStates } from "./layer6-node-checks.ts";
import { validateOutcomes } from "./layer6-outcome-checks.ts";
import { validatePopup } from "./layer6-popup-checks.ts";
import { isConsentTextRight } from "./layer6-popup-facts.ts";
import { WAIT_MS, openFreshPage, openScriptLayer, readRunPostIds } from "./layer6-steps.ts";

const SCRIPT_DOT_TOTAL = 20;
const DRAWER_SETTLED = `document.getElementById('drawer').classList.contains('open')
    && document.querySelector('#drawer .scriptbody pre')?.textContent.length > 0
    && document.querySelectorAll('#dbody details.dfile').length > 0`;

async function openNodeDrawer(page: HeadlessPage, toolUseId: string): Promise<void> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren();
        document.getElementById('drawer').classList.remove('open');
        ${buildNodeExpression(toolUseId)}.click()`);
  await page.waitFor(DRAWER_SETTLED, WAIT_MS);
}

async function validateNoButtonFor(page: HeadlessPage, toolUseId: string, name: string): Promise<void> {
  await openNodeDrawer(page, toolUseId);
  const count = await page.evaluate<number>(COUNT_CONSOLE_BUTTONS);
  reportCheck(`L6 the ${name} node opens the drawer with no Open run console button`, count === 0, count);
}

async function validateConsent(page: HeadlessPage): Promise<void> {
  const dialog = await page.evaluate<{ count: number; text: string; insideVizRoot: boolean }>(CONSENT_FACTS);
  const posts = await readRunPostIds(page);
  reportCheck("L6 the consent dialog is open once, inside .viz-root, before the first run request", dialog.count === 1 && dialog.insideVizRoot && posts.length === 0, { dialog, posts });
  reportCheck("L6 the dialog names copied files only, no network, a Docker container and Docker on, and not full access", isConsentTextRight(dialog.text), dialog.text);
  await page.evaluate(CLICK_RUN_SCRIPTS);
  await page.waitFor(`${buildDotClasses(PENDING_ID)}.includes('run-state-verified')`, WAIT_MS);
}

async function validateStartedButton(page: HeadlessPage): Promise<void> {
  await openNodeDrawer(page, PENDING_ID);
  const button = await page.evaluate<ButtonFacts>(BUTTON_FACTS);
  const isButtonRight = button.count === 1 && button.text === "Open run console" && button.insideDrawer;
  reportCheck("L6 the started pending run shows one Open run console button, inside the drawer", isButtonRight, button);
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

async function validateDotTotal(page: HeadlessPage): Promise<void> {
  const dotTotal = await page.evaluate<number>(COUNT_SCRIPT_DOTS);
  reportCheck("L6 the page draws 20 script nodes: 10 earlier ones and 10 run dots in far-apart bubbles", dotTotal === SCRIPT_DOT_TOTAL, dotTotal);
}

async function validatePendingRun(page: HeadlessPage): Promise<void> {
  await validateNoButtonFor(page, PENDING_ID, "pending");
  await validateNoButtonFor(page, NEVER_PROVABLE_ID, "never-provable");
  await validateConsent(page);
  await validateStartedButton(page);
}

export async function validateLayer6(page: HeadlessPage, pageUrl: string): Promise<void> {
  await openFreshPage(page, pageUrl);
  await openScriptLayer(page);
  await validateDotTotal(page);
  const nodes = await validateNodeStates(page);
  await validatePendingRun(page);
  const verifiedTitle = await validatePopup(page, nodes);
  await validateClose(page);
  await validateOutcomes(page, nodes, verifiedTitle);
  await validateClear(page);
  await validateBlocked(page, pageUrl);
  await openFreshPage(page, pageUrl);
}

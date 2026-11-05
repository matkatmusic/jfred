// Layer 6 blocked popup checks: the popup, its two buttons, the restart case and the run order.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { buildBubblePathExpression } from "./layer4-probes.ts";
import {
  CLICK_BLOCKED_CLOSE, CLICK_BLOCKED_GO, COUNT_BLOCKED_POPUPS, isBlockedBesideDot, isBlockedClippedByPane, isBlockedPopupRight, readBlockedFacts,
} from "./layer6-blocked-facts.ts";
import {
  BLOCKED_ID, BLOCKER_ID, CLEAR_RESULTS_PROBE, CLICK_RUN_SCRIPTS, COUNT_CONSENT_DIALOGS, NEVER_PROVABLE_ID, READ_DIALOG_COUNT, buildDotClasses,
  buildDotInView, buildNodeExpression,
} from "./layer6-probes.ts";
import { WAIT_MS, moveToDot, openFreshPage, openScriptLayer, readRunPostIds, waitForDebounce } from "./layer6-steps.ts";

const buildVerifiedProbe = (toolUseId: string) => `${buildDotClasses(toolUseId)}.includes('run-state-verified')`;

async function moveToBlockedPopup(page: HeadlessPage): Promise<void> {
  await moveToDot(page, BLOCKED_ID);
  await page.waitFor(`${COUNT_BLOCKED_POPUPS} === 1`, WAIT_MS);
}

async function validateShown(page: HeadlessPage): Promise<void> {
  await moveToBlockedPopup(page);
  const facts = await readBlockedFacts(page);
  const posts = await readRunPostIds(page);
  reportCheck("L6 the blocked dot shows #run-blocked-popup with close and Go to first unreplayed script node, and sends no run request",
    isBlockedPopupRight(facts) && !posts.includes(BLOCKED_ID), { facts, posts });
  reportCheck("L6 the blocked popup sits beside the blocked dot", isBlockedBesideDot(facts), facts);
  await waitForDebounce();
  const later = await readBlockedFacts(page);
  reportCheck("L6 after 400 ms, more than two debounces, there is still one popup", later.count === 1, later);
}

async function validateClosed(page: HeadlessPage): Promise<void> {
  await page.evaluate(CLICK_BLOCKED_CLOSE);
  const closed = await readBlockedFacts(page);
  reportCheck("L6 close removes the popup", closed.count === 0, closed);
  await moveToDot(page, NEVER_PROVABLE_ID);
  await waitForDebounce();
  await moveToDot(page, BLOCKED_ID);
  await waitForDebounce();
  const back = await readBlockedFacts(page);
  reportCheck("L6 after a scroll away and back past the debounce, a closed dot shows no popup", back.count === 0, back);
}

async function validateNoDialog(page: HeadlessPage): Promise<void> {
  const dialogCount = await page.evaluate<number>(READ_DIALOG_COUNT);
  reportCheck("L6 no native dialog is opened on this page", dialogCount === 0, dialogCount);
}

async function validateGoToFirst(page: HeadlessPage): Promise<void> {
  await moveToBlockedPopup(page);
  await page.evaluate(CLICK_BLOCKED_GO);
  await page.waitFor(buildDotInView(BLOCKER_ID), WAIT_MS);
  await page.waitFor(`${COUNT_CONSENT_DIALOGS} === 1`, WAIT_MS);
  await page.evaluate(CLICK_RUN_SCRIPTS);
  await page.waitFor(buildVerifiedProbe(BLOCKER_ID), WAIT_MS);
  const bubbles = await page.evaluate<string[]>(`[${buildBubblePathExpression(buildNodeExpression(BLOCKER_ID))}, ${buildBubblePathExpression(buildNodeExpression(BLOCKED_ID))}]`);
  const posts = await readRunPostIds(page);
  reportCheck("L6 Go to first unreplayed script node shows the blocker dot, in another bubble than the blocked dot", bubbles[0] !== bubbles[1], bubbles);
  reportCheck("L6 the blocker runs alone and gets run-state-verified", posts.length === 1 && posts[0] === BLOCKER_ID, posts);
}

async function validateRestart(page: HeadlessPage): Promise<void> {
  await page.evaluate(CLEAR_RESULTS_PROBE);
  await moveToBlockedPopup(page);
  const facts = await readBlockedFacts(page);
  const blockerClasses = await page.evaluate<string>(buildDotClasses(BLOCKER_ID));
  const posts = await readRunPostIds(page);
  const isRestartRight = !blockerClasses.includes("run-state-") && isBlockedPopupRight(facts) && !posts.includes(BLOCKED_ID);
  reportCheck("L6 after the server lost its results the blocker loses its run-state class, the popup shows and no run request goes out for the blocked dot",
    isRestartRight, { blockerClasses, facts, posts });
}

async function validatePlacement(page: HeadlessPage): Promise<void> {
  await page.evaluate(`${buildNodeExpression(BLOCKED_ID)}.click()`);
  await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, WAIT_MS);
  await waitForDebounce();
  const facts = await readBlockedFacts(page);
  reportCheck("L6 with the panel open, the popup stays in the timeline pane, so it never covers the panel", isBlockedClippedByPane(facts), facts);
}

async function validateBlockedRuns(page: HeadlessPage): Promise<void> {
  await page.evaluate(CLICK_BLOCKED_GO);
  await page.waitFor(buildVerifiedProbe(BLOCKER_ID), WAIT_MS);
  await moveToDot(page, BLOCKED_ID);
  await page.waitFor(buildVerifiedProbe(BLOCKED_ID), WAIT_MS);
  const posts = await readRunPostIds(page);
  const lastPostId = posts[posts.length - 1];
  reportCheck("L6 after its blocker ran again, the blocked dot runs once and gets run-state-verified", lastPostId === BLOCKED_ID, posts);
}

export async function validateBlocked(page: HeadlessPage, pageUrl: string): Promise<void> {
  await openFreshPage(page, pageUrl);
  await openScriptLayer(page);
  await validateShown(page);
  await validateClosed(page);
  await validateNoDialog(page);
  await openFreshPage(page, pageUrl);
  await openScriptLayer(page);
  await validateGoToFirst(page);
  await validateRestart(page);
  await validatePlacement(page);
  await validateBlockedRuns(page);
  await validateNoDialog(page);
}

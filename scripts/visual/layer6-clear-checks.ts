// Layer 6 clear checks: the crash pair popup, the header clear button and the page after it.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { COUNT_BLOCKED_POPUPS, isBlockerNamed, readBlockedFacts } from "./layer6-blocked-facts.ts";
import { CRASH_BLOCKED_ID, PENDING_ID } from "./layer6-probes.ts";
import { WAIT_MS, moveToDot, openScriptLayer, readClearPostCount, readRunPostIds } from "./layer6-steps.ts";
const CRASH_BLOCKER_FILE = "module_38.tsx";
const CRASHED_TEXT = "crashed or timed out";
const UNREPLAYED_TEXT = "not run yet";
const CLICK_CLEAR = `document.getElementById('clear-results').click()`;
const CLICK_CLEAR_YES = `document.getElementById('clear-results-yes').click()`;
const CLEAR_CONFIRM_FACTS = `({ confirmHidden: document.getElementById('clear-results-confirm').hidden,
    buttonHidden: document.getElementById('clear-results').hidden })`;
// True once the clear request is followed by a view request: the page reloaded.
const RELOAD_AFTER_CLEAR = `(() => {
    let seenClear = false;
    for (const e of window.__fetchLog) {
        if (e.path === '/api/layer1-clear-results') seenClear = true;
        else if (seenClear && e.path === '/api/layer1-view') return true;
    }
    return false;
})()`;
// Sticky flag: set when the pending dot is drawn with no run-state class.
const HOLLOW_WATCH_INSTALL = `(() => {
    window.__hollowSeen = false;
    new MutationObserver(() => {
        const dots = [...document.querySelectorAll('i.node.n-script[data-tool-use-id="${PENDING_ID}"]')];
        const isHollow = dots.length > 0 && dots.every(d => ![...d.classList].some(c => c.startsWith('run-state-')));
        if (isHollow) window.__hollowSeen = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
})()`;
const PENDING_POST_COUNT = `window.__fetchLog.filter(e => e.path === '/api/layer1-script-run'
    && JSON.parse(e.body).toolUseId === '${PENDING_ID}').length`;
const buildBlockerTextProbe =(state: string) =>
  `document.getElementById('run-blocked-popup')?.textContent.includes('${CRASH_BLOCKER_FILE}: ${state}') === true`;

async function validateCrashPair(page: HeadlessPage): Promise<void> {
  await moveToDot(page, CRASH_BLOCKED_ID);
  await page.waitFor(`${COUNT_BLOCKED_POPUPS} === 1`, WAIT_MS);
  const facts = await readBlockedFacts(page);
  const posts = await readRunPostIds(page);
  const isPopupRight = isBlockerNamed(facts, CRASH_BLOCKER_FILE, CRASHED_TEXT) && !posts.includes(CRASH_BLOCKED_ID);
  reportCheck("L6 after the crash pair the later dot shows the popup naming the crashed blocker and sends no run request", isPopupRight, { facts, posts });
}

async function validateAsksFirst(page: HeadlessPage): Promise<void> {
  await page.evaluate(CLICK_CLEAR);
  const confirm = await page.evaluate<{ confirmHidden: boolean; buttonHidden: boolean }>(CLEAR_CONFIRM_FACTS);
  const clearPosts = await readClearPostCount(page);
  const isAsking = !confirm.confirmHidden && confirm.buttonHidden && clearPosts === 0;
  reportCheck("L6 the clear button asks first: the confirmation shows and no request is sent yet", isAsking, { confirm, clearPosts });
}

async function validateCleared(page: HeadlessPage): Promise<void> {
  await page.evaluate(HOLLOW_WATCH_INSTALL);
  await page.evaluate(CLICK_CLEAR_YES);
  await page.waitFor(RELOAD_AFTER_CLEAR, WAIT_MS);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
  await openScriptLayer(page);
  const clearPosts = await readClearPostCount(page);
  const isHollow = await page.evaluate<boolean>(`window.__hollowSeen`);
  reportCheck("L6 Yes sends one clear request and the run dots are drawn again as hollow rings", clearPosts === 1 && isHollow, { clearPosts, isHollow });
}

async function validateRunsAgain(page: HeadlessPage): Promise<void> {
  await moveToDot(page, PENDING_ID);
  await page.waitFor(`${PENDING_POST_COUNT} >= 2`, WAIT_MS);
  const pendingPosts = await page.evaluate<number>(PENDING_POST_COUNT);
  reportCheck("L6 after the clear the pending run starts again: the page and the server forgot it", pendingPosts === 2, pendingPosts);
}

async function validateCrashReset(page: HeadlessPage): Promise<void> {
  await moveToDot(page, CRASH_BLOCKED_ID);
  await page.waitFor(buildBlockerTextProbe(UNREPLAYED_TEXT), WAIT_MS);
  const facts = await readBlockedFacts(page);
  reportCheck("L6 after the clear the later dot names its blocker as not run yet, no longer crashed", !isBlockerNamed(facts, CRASH_BLOCKER_FILE, CRASHED_TEXT), facts);
}

export async function validateClear(page: HeadlessPage): Promise<void> {
  await validateCrashPair(page);
  await validateAsksFirst(page);
  await validateCleared(page);
  await validateRunsAgain(page);
  await validateCrashReset(page);
}

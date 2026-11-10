// Task 358 steps 2 to 7: drives the real page and checks dialog, dot, console and drawer.

import { RUN_CONSOLE_NO_PROOF_NOTE, RUN_CONSOLE_OUTPUT_NOT_SAVED } from "../../webapp/layer1-components/details-drawer/layer1-run-console-data.ts";
import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { buildBubblePathExpression, buildDotsOfRun } from "./layer4-real-helpers.ts";
import { COUNT_SCRIPT_DOTS, STRIP_IDLE } from "./layer4-probes.ts";
import {
  FORBIDDEN_DIALOG_PHRASE, REQUIRED_DIALOG_PHRASES, convertStateClassToTerminalClass, findMissingPhrases, isRectLeftOf,
} from "./layer6-real-helpers.ts";
import { executeNeededRuns, type RealScript, type WireTarget } from "./layer6-real-pick.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const SCROLL_SETTLE_MS = 400;
const GO_SETTLE_MS = 600;
const DRAWER_TIMEOUT_MS = 60_000;
const UNPROVEN_TERMINAL_CLASS = "term-injected-unverified";

const WATCH_RUN_POSTS = `(() => { window.__runPosts = 0; const send = window.fetch;
    window.fetch = (input, init) => { const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.pathname === '/api/layer1-script-run') window.__runPosts += 1; return send(input, init); }; })()`;
const READ_RUN_POSTS = `window.__runPosts`;
const IS_CONSENT_OPEN = `document.querySelector('.run-consent') !== null`;
const IS_BLOCKED_POPUP = `document.getElementById('run-blocked-popup') !== null`;
const CLICK_GO = `document.querySelector('#run-blocked-popup .blocked-go').click()`;
const CLICK_RUN_SCRIPTS = `document.querySelector('.run-consent .consent-run').click()`;
const READ_DIALOG_TEXT = `document.querySelector('.run-consent .consent-note').textContent`;
const CONSOLE_TEXT = `document.getElementById('run-console')?.textContent ?? ''`;
const COUNT_CONSOLE_BUTTONS = `document.querySelectorAll('.run-console-open').length`;
const COUNT_DRAWER_BUTTONS = `document.querySelectorAll('#drawer .run-console-open').length`;
const CLICK_CONSOLE_BUTTON = `document.querySelector('#drawer .run-console-open').click()`;
const READ_BASH_FACTS = `(dot => ({ count: document.querySelectorAll('i.node.n-script.never-provable').length, classes: dot?.className ?? '' }))
    (document.querySelector('i.node.n-script.never-provable'))`;
const RESET_DRAWER = `document.getElementById('dbody').replaceChildren(); document.getElementById('dpath').textContent = '';
    document.getElementById('drawer').classList.remove('open')`;
const IS_DRAWER_FILLED = `document.getElementById('drawer').classList.contains('open') && document.getElementById('dpath').textContent.trim().length > 0`;

const buildChangedDotExpression = (picked: RealScript) =>
  `${buildDotsOfRun(picked.toolUseId)}.find(d => ${buildBubblePathExpression("d")} === ${JSON.stringify(picked.changedPaths[0])})`;
// const buildScrollExpression = (picked: RealScript) => `${buildChangedDotExpression(picked)}.scrollIntoView({ block: 'center', inline: 'center' })`;
// Scroll to the changed file's dot, else any dot of the run; false if none.
export const buildMoveTowardDotExpression = (picked: RealScript) =>
  `(dots => { const target = dots.find(d => ${buildBubblePathExpression("d")} === ${JSON.stringify(picked.changedPaths[0])}) ?? dots[0];
      if (target === undefined) return false;
      target.scrollIntoView({ block: 'center', inline: 'center' });
      return true; })(${buildDotsOfRun(picked.toolUseId)})`;
const buildClickDotExpression = (picked: RealScript) => `${buildChangedDotExpression(picked)}.click()`;
// Dots sit only on changed files: a rating mark, or a deleted or not-text mark.
export const buildStateExpression = (id: string, changedPaths: string[]) =>
  `((dots, changedPaths) => changedPaths.every(p => dots.some(d => ${buildBubblePathExpression("d")} === p)) && dots.every(d => {
      const mark = d.querySelector('.run-mark');
      const rating = [...d.classList].find(c => c.startsWith('run-state-'));
      const isChanged = changedPaths.includes(${buildBubblePathExpression("d")});
      const isChangeMark = mark !== null && (mark.classList.contains('mark-deleted') || mark.classList.contains('mark-changed-not-text'));
      const isMarkRight = rating !== undefined ? mark !== null && mark.classList.contains('mark-' + rating.slice('run-state-'.length)) : isChangeMark;
      return isChanged && d.classList.contains('run-end-replayed') && isMarkRight;
    }))(${buildDotsOfRun(id)}, ${JSON.stringify(changedPaths)})`;
// const buildStateExpression = (id: string, changedPaths: string[]) =>
//   `((dots, changedPaths) => dots.length > 0 && changedPaths.every(p => dots.some(d => ${buildBubblePathExpression("d")} === p)) && dots.every(d => {
//       const mark = d.querySelector('.run-mark');
//       const rating = [...d.classList].find(c => c.startsWith('run-state-'));
//       const isChanged = changedPaths.includes(${buildBubblePathExpression("d")});
//       const markName = isChanged ? 'mark-' + (rating ?? '').slice('run-state-'.length) : 'mark-replayed';
//       return d.classList.contains('run-end-replayed') && mark !== null && mark.classList.contains(markName) && isChanged === (rating !== undefined);
//     }))(${buildDotsOfRun(id)}, ${JSON.stringify(changedPaths)})`;
// const buildStateExpression = (id: string) =>
//   `(dots => dots.length > 0 && dots.every(d => [...d.classList].some(c => c.startsWith('run-state-'))))(${buildDotsOfRun(id)})`;
// The terminal block shows the run's verdict (worst rating of all files), not the first changed file's dot.
const buildConsoleFacts = (picked: RealScript) => `import('/app/layer1-run-results.js').then(results => ({
    runStateClass: 'run-state-' + results.getRunResult(${JSON.stringify(picked.toolUseId)}).confidence,
    isShown: !document.getElementById('run-console').hidden,
    blocks: [...document.querySelectorAll('#run-console .terminal-block')].map(b => b.className),
    noteTexts: [...document.querySelectorAll('#run-console .run-console-note')].map(n => n.textContent),
    popupText: document.getElementById('run-console').textContent,
    preText: document.querySelector('#run-console .console-pre')?.textContent ?? '',
    popupRight: document.getElementById('run-console').getBoundingClientRect().right,
    drawerLeft: document.getElementById('drawer').getBoundingClientRect().left }))`;

const buildConsoleButtonFacts = (picked: RealScript) => `({ buttonCount: ${COUNT_CONSOLE_BUTTONS}, drawerButtonCount: ${COUNT_DRAWER_BUTTONS},
    dotClasses: ${buildChangedDotExpression(picked)}?.className, drawerTitle: document.getElementById('dpath').textContent,
    drawerBodyStart: document.getElementById('dbody').textContent.slice(0, 200) })`;

interface ConsoleFacts {
  runStateClass: string; isShown: boolean; blocks: string[]; noteTexts: string[]; popupText: string; preText: string;
  popupRight: number; drawerLeft: number;
}

// A blocked popup is answered with its go button; otherwise the dot is scrolled into view.
async function moveTowardDot(page: HeadlessPage, picked: RealScript): Promise<void> {
  const isBlocked = await page.evaluate<boolean>(IS_BLOCKED_POPUP);
  if (isBlocked) {
    await page.evaluate(CLICK_GO);
    await waitMilliseconds(GO_SETTLE_MS);
    return;
  }
  await page.evaluate(buildMoveTowardDotExpression(picked));
  await waitMilliseconds(SCROLL_SETTLE_MS);
}

async function waitUntilReached(page: HeadlessPage, goal: string, picked: RealScript, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isReached = await page.evaluate<boolean>(`!!(${goal})`);
    if (isReached) {
      return true;
    }
    await moveTowardDot(page, picked);
  }
  return false;
}

async function validateDialog(page: HeadlessPage, picked: RealScript, timeoutMs: number): Promise<void> {
  await page.evaluate(WATCH_RUN_POSTS);
  await page.evaluate(`document.getElementById('layer-4').click()`);
  await page.waitFor(`${COUNT_SCRIPT_DOTS} > 0 && ${STRIP_IDLE}`, timeoutMs);
  const isOpen = await waitUntilReached(page, IS_CONSENT_OPEN, picked, timeoutMs);
  if (!isOpen) {
    throw new Error(`the permission dialog never opened (run ${picked.toolUseId}, changed file ${picked.changedPaths[0]})`);
  }
  reportCheck("l6-real no run request before the dialog is answered", await page.evaluate<number>(READ_RUN_POSTS) === 0);
  const text = await page.evaluate<string>(READ_DIALOG_TEXT);
  const missing = findMissingPhrases(text, REQUIRED_DIALOG_PHRASES);
  reportCheck("l6-real the dialog text has the box phrases", missing.length === 0, missing);
  reportCheck("l6-real the dialog text does not say full access", !text.includes(FORBIDDEN_DIALOG_PHRASE), text);
  await page.evaluate(CLICK_RUN_SCRIPTS);
}

async function openDrawerOf(page: HeadlessPage, click: string): Promise<void> {
  await page.evaluate(`${RESET_DRAWER}; ${click}`);
  await page.waitFor(IS_DRAWER_FILLED, DRAWER_TIMEOUT_MS);
}

function validateTerminalBlock(facts: ConsoleFacts): void {
  const expected = convertStateClassToTerminalClass(facts.runStateClass);
  const isUnproven = expected === UNPROVEN_TERMINAL_CLASS;
  const blockClasses = facts.blocks[0]?.split(" ") ?? [];
  const isBlockRight = facts.blocks.length === 1 && expected !== undefined && blockClasses.includes(expected);
  const isNoteRight = facts.blocks.length === 0 && facts.noteTexts.includes(RUN_CONSOLE_NO_PROOF_NOTE);
  const name = isUnproven ? "the no-proof note shows and no terminal block" : "the terminal block matches the dot state";
  reportCheck(`l6-real ${name}`, isUnproven ? isNoteRight : isBlockRight, { expected, blocks: facts.blocks, notes: facts.noteTexts });
}

function validateConsoleFacts(facts: ConsoleFacts): void {
  const hasOutput = facts.preText.trim() !== "" || facts.popupText.includes(RUN_CONSOLE_OUTPUT_NOT_SAVED);
  reportCheck("l6-real the console is visible", facts.isShown);
  validateTerminalBlock(facts);
  reportCheck("l6-real the console has output or the not-saved note", hasOutput, facts.popupText);
  reportCheck("l6-real the popup is left of the drawer", isRectLeftOf(facts.popupRight, facts.drawerLeft), facts);
}

async function validateConsole(page: HeadlessPage, picked: RealScript): Promise<void> {
  await openDrawerOf(page, buildClickDotExpression(picked));
  const buttonFacts = await page.evaluate<unknown>(buildConsoleButtonFacts(picked));
  const buttonCount = await page.evaluate<number>(COUNT_CONSOLE_BUTTONS);
  reportCheck("l6-real the console button exists only for the started run", buttonCount === 1, buttonFacts);
  if (buttonCount === 0) {
    await saveScreenshot(page, "14-layer6-real");
    return;
  }
  await page.evaluate(CLICK_CONSOLE_BUTTON);
  validateConsoleFacts(await page.evaluate<ConsoleFacts>(buildConsoleFacts(picked)));
}

async function validateBashDot(page: HeadlessPage): Promise<void> {
  const bash = await page.evaluate<{ count: number; classes: string }>(READ_BASH_FACTS);
  if (bash.count === 0) {
    console.log("l6-real no bash dot is drawn: step 6 skipped");
    return;
  }
  reportCheck("l6-real a bash dot has no run-state class", !bash.classes.includes("run-state-"), bash.classes);
  reportCheck("l6-real a bash dot has no run-end class", !bash.classes.includes("run-end-"), bash.classes);
  await openDrawerOf(page, `document.querySelector('i.node.n-script.never-provable').click()`);
  reportCheck("l6-real a bash drawer has no console button", await page.evaluate<number>(COUNT_DRAWER_BUTTONS) === 0);
}

// The server already holds the earlier runs (step 1); the needs question proves the picked run may start.
export async function executeLayer6RealChecks(page: HeadlessPage, target: WireTarget, picked: RealScript, timeoutMs: number): Promise<void> {
  const isClear = await executeNeededRuns(target, picked, []);
  reportCheck("l6-real the picked run needs no earlier run", isClear);
  await validateDialog(page, picked, timeoutMs);
  const hasState = await waitUntilReached(page, buildStateExpression(picked.toolUseId, picked.changedPaths), picked, timeoutMs);
  reportCheck(`l6-real every dot of run ${picked.toolUseId} shows the run state and each changed file's dot (${picked.changedPaths.join(", ")}) its rating`, hasState, await page.evaluate<string>(CONSOLE_TEXT));
  if (hasState) {
    await validateConsole(page, picked);
  }
  await validateBashDot(page);
  await saveScreenshot(page, "14-layer6-real");
}

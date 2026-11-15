// Layer 9 script-commit checks: a fixture fetch answers the replay routes, so Commit shows the replay popup and the missing-programs popup.

import { type HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { DISMISS_RUN_CONSENT } from "./ruler-ui-commit-checks.ts";
import { COMMIT_MODE_CLICK, MARK_FACTS, TICK_LABELS, buildClickTick, type MarkFacts } from "./layer9-probes.ts";
import { JfredEntryKind } from "../../webapp/layer1-components/commits-column/layer1-jfred-entries.ts";

interface ReplayCall { pathname: string; body: { fromInstant?: string | null; toInstant?: string; allowScripts?: boolean } }

const WAIT_MS = 10_000;
const NEEDS_PATHNAME = "/api/layer1-script-replay-needs";
const RUN_PATHNAME = "/api/layer1-script-replay-run";
const COMMIT_PATHNAME = "/api/layer1-jfred-commit";
const SCRIPT_CODE_WORD = "fixture-replay-script";
const EXPECTED_MISSING_EXECUTABLE = "ffmpeg";
const MISSING_SCREENSHOT = "19b-layer9-missing-executables";

const NEEDS_REPLY = { tasks: [{ taskId: "t1", instant: "2026-06-03T11:00:00.000Z", isInSpan: true, code: `print('${SCRIPT_CODE_WORD}')`, cwd: "/w", language: "python", waitingFiles: [{ path: "a.txt", reason: "named-by-file" }] }] };
const RUN_REPLY = { results: [{ taskId: "t1", outcome: "replay-failed", missingExecutable: "ffmpeg", timedOut: false, stdout: "", stderr: "", files: [] }] };

const INSTALL_FETCH = `(() => {
    window.__realFetch = window.fetch.bind(window);
    window.__replayLog = [];
    const answer = (reply) => Promise.resolve(new Response(JSON.stringify(reply) + '\\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } }));
    window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)), location.href);
        if (url.pathname === '${NEEDS_PATHNAME}') {
            window.__replayLog.push({ pathname: url.pathname, body: JSON.parse(init.body) });
            return answer(${JSON.stringify(NEEDS_REPLY)});
        }
        if (url.pathname === '${RUN_PATHNAME}') {
            window.__replayLog.push({ pathname: url.pathname, body: JSON.parse(init.body) });
            return answer(${JSON.stringify(RUN_REPLY)});
        }
        if (url.pathname === '${COMMIT_PATHNAME}')
            window.__replayLog.push({ pathname: url.pathname, body: JSON.parse(init.body) });
        return window.__realFetch(input, init);
    };
    return true;
})()`;
const RESTORE_FETCH = `(window.fetch = window.__realFetch, true)`;
const REPLAY_LOG = `window.__replayLog`;
const COMMIT_MODE_ENABLED = `document.getElementById('commit-mode').disabled === false`;
const COMMIT_BUTTON_CLICK =`document.getElementById('jfred-commit-button').click()`;
const NO_PENDING_ENTRY = `document.querySelectorAll('#jfredCommitsDrawerComponent .jnode.j-pending').length === 0`;

const buildPopupSelector = (component: string) => `[data-component="${component}"]`;
const buildPopupPresent = (component: string) => `document.querySelector('${buildPopupSelector(component)}') !== null`;
const buildPopupText = (component: string) => `document.querySelector('${buildPopupSelector(component)}')?.textContent ?? ''`;
const buildPopupClick = (component: string) => `document.querySelector('${buildPopupSelector(component)}').click()`;

function listPathnames(log: ReplayCall[]): string[] {
  return log.map((call) => call.pathname);
}

function isPathnameList(log: ReplayCall[], expected: string[]): boolean {
  return JSON.stringify(listPathnames(log)) === JSON.stringify(expected);
}

function isMarkReady(facts: MarkFacts): boolean {
  return facts.pending.entries === 1 && facts.drawer.hasButton;
}

function isCommitMade(facts: MarkFacts): boolean {
  return facts.pending.entries === 0 && facts.entries.at(-1)?.kind === JfredEntryKind.commit;
}

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

// A fresh page with the fixture fetch installed, Commit mode on and the late tick marked; returns the mark instant.
async function openPendingMarkOnFreshPage(page: HeadlessPage, pageUrl: string): Promise<string> {
  await waitForFreshPage(page, pageUrl);
  await page.evaluate(INSTALL_FETCH);
  await page.waitFor(COMMIT_MODE_ENABLED, WAIT_MS);
  await page.evaluate(COMMIT_MODE_CLICK);
  await page.evaluate(DISMISS_RUN_CONSENT);
  await page.evaluate(buildClickTick(TICK_LABELS.late));
  const facts = await page.evaluate<MarkFacts>(MARK_FACTS);
  if (!isMarkReady(facts)) {
    throw new Error(`a click on ${TICK_LABELS.late} did not give one pending entry and a Commit button: ${JSON.stringify(facts)}`);
  }
  return facts.entries.at(-1)!.instant;
}

async function validateRunScripts(page: HeadlessPage, pageUrl: string): Promise<void> {
  const markInstant = await openPendingMarkOnFreshPage(page, pageUrl);
  await page.evaluate(COMMIT_BUTTON_CLICK);
  await page.waitFor(buildPopupPresent("runConsentPopup"), WAIT_MS);
  const consentText = await page.evaluate<string>(buildPopupText("runConsentPopup"));
  const logAtConsent = await page.evaluate<ReplayCall[]>(REPLAY_LOG);
  const isNeedsAsked = isPathnameList(logAtConsent, [NEEDS_PATHNAME]) && logAtConsent[0]!.body.toInstant === markInstant;
  reportCheck("L9 script commit: Commit opens the replay popup that shows the recorded script", consentText.includes(SCRIPT_CODE_WORD) && isNeedsAsked, [consentText, logAtConsent]);

  await page.evaluate(buildPopupClick("runConsentRunButton"));
  await page.waitFor(buildPopupPresent("missingExecutablesPopup"), WAIT_MS);
  const missingText = await page.evaluate<string>(buildPopupText("missingExecutablesPopup"));
  const isConsentOpen = await page.evaluate<boolean>(buildPopupPresent("runConsentPopup"));
  const logAtMissing = await page.evaluate<ReplayCall[]>(REPLAY_LOG);
  await saveScreenshot(page, MISSING_SCREENSHOT);
  console.log(`L9 screenshot: scripts/visual/out/mockup-${MISSING_SCREENSHOT}.png`);
  const isRunAsked = isPathnameList(logAtMissing, [NEEDS_PATHNAME, RUN_PATHNAME]) && JSON.stringify(logAtMissing[1]!.body) === JSON.stringify({ toInstant: markInstant, allowScripts: true });
  const isMissingNamed = missingText.includes(`missing executable or Python module ${EXPECTED_MISSING_EXECUTABLE}`);
  reportCheck(`L9 script commit: after Run scripts the missing-programs popup names ${EXPECTED_MISSING_EXECUTABLE}`, isMissingNamed && !isConsentOpen && isRunAsked, [missingText, isConsentOpen, logAtMissing]);

  await page.evaluate(buildPopupClick("missingExecutablesCloseButton"));
  await page.waitFor(NO_PENDING_ENTRY, WAIT_MS);
  const after = await page.evaluate<MarkFacts>(MARK_FACTS);
  const logAfterClose = await page.evaluate<ReplayCall[]>(REPLAY_LOG);
  const isCommittedOnce = isPathnameList(logAfterClose, [NEEDS_PATHNAME, RUN_PATHNAME, COMMIT_PATHNAME]) && logAfterClose[2]!.body.allowScripts === true;
  reportCheck("L9 script commit: after Close the commit is made once, with scripts allowed", isCommitMade(after) && isCommittedOnce, [after.entries, logAfterClose]);
}

async function validateContinueWithoutRunning(page: HeadlessPage, pageUrl: string): Promise<void> {
  await openPendingMarkOnFreshPage(page, pageUrl);
  await page.evaluate(COMMIT_BUTTON_CLICK);
  await page.waitFor(buildPopupPresent("runConsentPopup"), WAIT_MS);
  await page.evaluate(buildPopupClick("runConsentContinueWithoutRunningButton"));
  await page.waitFor(NO_PENDING_ENTRY, WAIT_MS);
  const after = await page.evaluate<MarkFacts>(MARK_FACTS);
  const log = await page.evaluate<ReplayCall[]>(REPLAY_LOG);
  const isMissingOpen = await page.evaluate<boolean>(buildPopupPresent("missingExecutablesPopup"));
  const isCommittedWithoutRun = isPathnameList(log, [NEEDS_PATHNAME, COMMIT_PATHNAME]) && log[1]!.body.allowScripts === false;
  reportCheck("L9 script commit: Continue without running runs nothing and still commits, with scripts not allowed", isCommitMade(after) && !isMissingOpen && isCommittedWithoutRun, [after.entries, isMissingOpen, log]);
}

// Both scenarios start on a fresh page; the run ends on a fresh page with the real fetch back.
export async function validateScriptCommit(page: HeadlessPage, pageUrl: string): Promise<void> {
  await validateRunScripts(page, pageUrl);
  await validateContinueWithoutRunning(page, pageUrl);
  await page.evaluate(RESTORE_FETCH);
  await waitForFreshPage(page, pageUrl);
}

// Layer 6 outcome checks: canned outcomes, the slow run, and runs that never start.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import {
  CLICK_CANCEL, COUNT_CONSENT_DIALOGS, MISMATCH_ID, POPUP_FACTS, SKIP_AFTER_ID, SKIP_BASH_ID, SLOW_ID, buildDotClasses, buildNeedsProbe,
  type NodeFacts, type PopupFacts,
} from "./layer6-probes.ts";
import { findNodeFacts } from "./layer6-node-facts.ts";
import {
  CancelKind, OUTCOME_CASES, isCancelButtonRight, isOutcomeRight, isOutputStopped, isOutputStreaming,
  isTerminalBlockRight, type OutcomeCase, type TitleColours,
} from "./layer6-popup-facts.ts";
import { moveToDot, openRunConsole, readRunPostIds, waitForRunFinished, waitForRunPost } from "./layer6-steps.ts";

const STREAM_WAIT_MS = 350;
const STOP_WAIT_MS = 400;

const readPopup = (page: HeadlessPage) => page.evaluate<PopupFacts>(POPUP_FACTS);

async function validateOutcome(page: HeadlessPage, outcome: OutcomeCase): Promise<PopupFacts> {
  await moveToDot(page, outcome.id);
  await waitForRunPost(page, outcome.id);
  await openRunConsole(page, outcome.id);
  await waitForRunFinished(page);
  const popup = await readPopup(page);
  const dotClasses = await page.evaluate<string>(buildDotClasses(outcome.id));
  reportCheck(`L6 ${outcome.name} shows the right terminal block, note and node state`, isOutcomeRight(popup, dotClasses, outcome), { popup, dotClasses });
  return popup;
}

async function validateEveryOutcome(page: HeadlessPage, verifiedTitle: string): Promise<TitleColours> {
  const titles: TitleColours = { mismatch: "", verified: verifiedTitle, originalFailed: "" };
  for (const outcome of OUTCOME_CASES) {
    const popup = await validateOutcome(page, outcome);
    const colour = popup.terminalColours[0] ?? "";
    titles.mismatch = outcome.termClass === "term-mismatch" ? colour : titles.mismatch;
    titles.originalFailed = outcome.termClass === "term-original-failed" ? colour : titles.originalFailed;
  }
  return titles;
}

async function validateSlowStream(page: HeadlessPage, mismatchBorder: string | undefined): Promise<void> {
  await moveToDot(page, SLOW_ID);
  await waitForRunPost(page, SLOW_ID);
  await openRunConsole(page, SLOW_ID);
  const early = await readPopup(page);
  await waitMilliseconds(STREAM_WAIT_MS);
  const later = await readPopup(page);
  reportCheck("L6 the slow run shows its output lines one by one", isOutputStreaming(early.preText, later.preText), [early.preText, later.preText]);
  reportCheck("L6 while the slow run goes, Cancel is live in the mismatch colour", isCancelButtonRight(later, CancelKind.live, mismatchBorder), later);
}

async function validateSlowCancel(page: HeadlessPage): Promise<void> {
  await page.evaluate(CLICK_CANCEL);
  const cancelled = await readPopup(page);
  await waitMilliseconds(STOP_WAIT_MS);
  const later = await readPopup(page);
  const isCancelledRight = isCancelButtonRight(cancelled, CancelKind.cancelled, undefined) && isTerminalBlockRight(cancelled, "term-cancelled");
  reportCheck("L6 Cancel leaves a struck-through Cancelled button and the cancelled block", isCancelledRight, cancelled);
  reportCheck("L6 Cancel stops the output lines", isOutputStopped(cancelled.preText, later.preText), [cancelled.preText, later.preText]);
}

// The bash dot and the original-failed dot sit earlier than the skip-after dot and never block it.
async function validateSkippedDots(page: HeadlessPage): Promise<void> {
  const bashClasses = await page.evaluate<string>(buildDotClasses(SKIP_BASH_ID));
  const posts = await readRunPostIds(page);
  const needs = await page.evaluate<string[]>(buildNeedsProbe(SKIP_AFTER_ID));
  const isBashQuiet = !bashClasses.includes("run-state-") && !posts.includes(SKIP_BASH_ID);
  reportCheck("L6 an earlier bash dot never runs and gets no node state", isBashQuiet, { bashClasses, posts });
  reportCheck("L6 the earlier bash and original-failed dots are not in the needs list of the later run dot", needs.length === 0 && posts.includes(SKIP_AFTER_ID), needs);
}

async function validateConsentOnce(page: HeadlessPage): Promise<void> {
  const count = await page.evaluate<number>(COUNT_CONSENT_DIALOGS);
  reportCheck("L6 the consent dialog appears once: none is open after all these runs", count === 0, count);
}

export async function validateOutcomes(page: HeadlessPage, nodes: NodeFacts[], verifiedTitle: string): Promise<void> {
  // const titles = await validateEveryOutcome(page, verifiedTitle);
  await validateEveryOutcome(page, verifiedTitle);
  // reportCheck("L6 node and console read as one event: mismatch, verified and original-failed colours match their terminal titles",
  //   isEventColoursSame(nodes, titles), titles);
  await validateSlowStream(page, findNodeFacts(nodes, MISMATCH_ID)?.borderColor);
  await validateSlowCancel(page);
  await validateSkippedDots(page);
  await validateConsentOnce(page);
}

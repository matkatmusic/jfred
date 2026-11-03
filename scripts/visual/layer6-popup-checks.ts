// Layer 6 popup checks: open the run console from the drawer, then judge its content, colours, placement and silence.

import { waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import {
  CLICK_CANCEL, CLICK_OPEN_BUTTON, MISMATCH_ID, POPUP_FACTS, POPUP_TEXT, RESOURCE_NAMES, buildTitleColour, type NodeFacts, type PopupFacts,
} from "./layer6-probes.ts";
import { findNodeFacts } from "./layer6-node-facts.ts";
import {
  isCancelButtonsRight, isEventColoursSame, isTerminalBlocksRight, isPopupClearOfDrawer, isPopupContentRight, isPopupShown,
  listNewResources,
} from "./layer6-popup-facts.ts";

const SETTLE_MS = 1_000;
const QUIET_MS = 700;
const CONSENT_WORDS = /consent|allow|permit|proceed/i;

interface OpenedPopup { popup: PopupFacts; text: string; resources: string[] }

const readResourceNames = (page: HeadlessPage) => page.evaluate<string[]>(RESOURCE_NAMES);

// The drawer loads diff panes late; wait until its own requests stop so only the popup's would count.
async function waitForQuietRequests(page: HeadlessPage): Promise<void> {
  let previousCount = -1;
  let names = await readResourceNames(page);
  while (names.length !== previousCount) {
    previousCount = names.length;
    await waitMilliseconds(QUIET_MS);
    names = await readResourceNames(page);
  }
}

async function validateOpening(page: HeadlessPage): Promise<OpenedPopup> {
  await waitForQuietRequests(page);
  const resourcesBefore = await readResourceNames(page);
  await page.evaluate(CLICK_OPEN_BUTTON);
  const popup = await page.evaluate<PopupFacts>(POPUP_FACTS);
  const text = await page.evaluate<string>(POPUP_TEXT);
  const resources = await readResourceNames(page);
  reportCheck("L6 Open run console shows a visible popup that is not inside the drawer, and the drawer stays open", isPopupShown(popup), popup);
  reportCheck("L6 opening the popup makes no request", resources.length === resourcesBefore.length, listNewResources(resourcesBefore, resources));
  const hasConsentWords = CONSENT_WORDS.test(text);
  reportCheck("L6 the popup has no consent wording", !hasConsentWords, text);
  return { popup, text, resources };
}

async function validateStillness(page: HeadlessPage, opened: OpenedPopup): Promise<void> {
  await waitMilliseconds(SETTLE_MS);
  const textLater = await page.evaluate<string>(POPUP_TEXT);
  reportCheck("L6 the popup text does not change over 1 second", textLater === opened.text, textLater);
}

function validateContent(popup: PopupFacts, nodes: NodeFacts[]): void {
  const mismatchNode = findNodeFacts(nodes, MISMATCH_ID);
  reportCheck("L6 the popup holds one pre with pre white-space, one console caption in italic and one state caption", isPopupContentRight(popup), popup);
  reportCheck("L6 the popup has 3 cancel buttons: idle disabled, live enabled in the mismatch colour, cancelled disabled and struck through",
    isCancelButtonsRight(popup,mismatchNode?.borderColor), popup);
  reportCheck("L6 the popup has 4 terminal blocks with 4 different title colours", isTerminalBlocksRight(popup), popup);
}

async function validateSameEvent(page: HeadlessPage, nodes: NodeFacts[]): Promise<void> {
  const titles = {
    mismatch: await page.evaluate<string>(buildTitleColour("term-mismatch")),
    verified: await page.evaluate<string>(buildTitleColour("term-verified")),
    originalFailed: await page.evaluate<string>(buildTitleColour("term-original-failed")),
  };
  reportCheck("L6 node and console read as one event: mismatch, verified and original-failed colours match their terminal titles",
    isEventColoursSame(nodes, titles), titles);
}

async function validatePlacement(page: HeadlessPage, popup: PopupFacts): Promise<void> {
  reportCheck("L6 the popup floats over the timeline: inside the stage, overlapping the timelines, clear of the open drawer",
    isPopupClearOfDrawer(popup), popup);
  await saveScreenshot(page, "13-layer6-popup");
  console.log("L6 screenshot: scripts/visual/out/mockup-13-layer6-popup.png");
}

async function validateCancel(page: HeadlessPage, opened: OpenedPopup): Promise<void> {
  await page.evaluate(CLICK_CANCEL);
  const resources = await readResourceNames(page);
  const textNow = await page.evaluate<string>(POPUP_TEXT);
  const isQuiet = resources.length === opened.resources.length && textNow === opened.text;
  reportCheck("L6 cancel does nothing: no request and the same popup text", isQuiet, listNewResources(opened.resources, resources));
}

export async function validatePopup(page: HeadlessPage, nodes: NodeFacts[]): Promise<void> {
  const opened = await validateOpening(page);
  await validateStillness(page, opened);
  validateContent(opened.popup, nodes);
  await validateSameEvent(page, nodes);
  await validatePlacement(page, opened.popup);
  await validateCancel(page, opened);
}

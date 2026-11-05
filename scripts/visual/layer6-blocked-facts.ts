// Layer 6 blocked popup facts: the DOM reader, the click expressions and the pure judges.

import { type HeadlessPage } from "./cdp.ts";
import { BLOCKED_ID, buildNodeExpression } from "./layer6-probes.ts";

export interface BlockedFacts {
  count: number; buttons: string[]; text: string; insideStagewrap: boolean; popupRect: number[]; dotRect: number[]; drawerRect: number[]; drawerOpen: boolean;
}

const BESIDE_DOT_MAX_GAP_PX = 12;

export const BLOCKED_BUTTON_TEXTS = ["close", "Go to first unreplayed script node"];
export const COUNT_BLOCKED_POPUPS = `document.querySelectorAll('#run-blocked-popup').length`;
export const CLICK_BLOCKED_CLOSE = `document.querySelector('#run-blocked-popup .blocked-close').click()`;
export const CLICK_BLOCKED_GO = `document.querySelector('#run-blocked-popup .blocked-go').click()`;

const BLOCKED_FACTS = `(() => {
    const popup = document.getElementById('run-blocked-popup');
    const box = popup?.getBoundingClientRect();
    const drawer = document.getElementById('drawer');
    const rect = r => r === undefined ? [] : [r.left, r.top, r.right, r.bottom];
    return { count: ${COUNT_BLOCKED_POPUPS}, text: popup?.textContent ?? '',
        dotRect: rect(${buildNodeExpression(BLOCKED_ID)}?.getBoundingClientRect()),
        buttons: popup === null ? [] : [...popup.querySelectorAll('button')].map(b => b.textContent),
        insideStagewrap: popup?.closest('#stagewrap') != null, popupRect: rect(box), drawerRect: rect(drawer.getBoundingClientRect()),
        drawerOpen: drawer.classList.contains('open') };
})()`;

export function readBlockedFacts(page: HeadlessPage): Promise<BlockedFacts> {
  return page.evaluate<BlockedFacts>(BLOCKED_FACTS);
}

export function isBlockedPopupRight(facts: BlockedFacts): boolean {
  const hasButtons = JSON.stringify(facts.buttons) === JSON.stringify(BLOCKED_BUTTON_TEXTS);
  return facts.count === 1 && facts.insideStagewrap && hasButtons;
}

// Rects are [left, top, right, bottom]: the gap across is within 12 px and the two overlap down.
export function isBlockedBesideDot(facts: BlockedFacts): boolean {
  const [popupLeft, popupTop, popupRight, popupBottom] = facts.popupRect;
  const [dotLeft, dotTop, dotRight, dotBottom] = facts.dotRect;
  const isMeasured = popupRight !== undefined && dotRight !== undefined;
  if (!isMeasured) {
    return false;
  }
  const gapAcross = Math.max(popupLeft! - dotRight, dotLeft! - popupRight);
  const isOverlappingDown = popupTop! < dotBottom! && dotTop! < popupBottom!;
  return facts.count === 1 && gapAcross <= BESIDE_DOT_MAX_GAP_PX && isOverlappingDown;
}

export function isBlockedClearOfDrawer(facts: BlockedFacts): boolean {
  const popupRight = facts.popupRect[2] ?? Infinity;
  const drawerLeft = facts.drawerRect[0] ?? 0;
  return facts.count === 1 && facts.insideStagewrap && facts.drawerOpen && popupRight <= drawerLeft;
}

export function isBlockerNamed(facts: BlockedFacts, toolUseId: string, stateText: string): boolean {
  return facts.text.includes(`${toolUseId}: ${stateText}`);
}

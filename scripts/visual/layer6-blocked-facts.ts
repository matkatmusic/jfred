// Layer 6 blocked popup facts: the DOM reader, the click expressions and the pure judges.

import { type HeadlessPage } from "./cdp.ts";

export interface BlockedFacts {
  count: number; buttons: string[]; text: string; insideStagewrap: boolean; popupRect: number[]; drawerRect: number[]; drawerOpen: boolean;
}

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

export function isBlockedClearOfDrawer(facts: BlockedFacts): boolean {
  const popupRight = facts.popupRect[2] ?? Infinity;
  const drawerLeft = facts.drawerRect[0] ?? 0;
  return facts.count === 1 && facts.insideStagewrap && facts.drawerOpen && popupRight <= drawerLeft;
}

export function isBlockerNamed(facts: BlockedFacts, toolUseId: string, stateText: string): boolean {
  return facts.text.includes(`${toolUseId}: ${stateText}`);
}

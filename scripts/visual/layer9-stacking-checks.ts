// Layer 9 stacking check: the strip's dashed line runs behind session text, and the session bar stays clickable.

import { type HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { SCROLL_HOME } from "./layer7-probes.ts";
import { isIntersecting } from "./layer9-layout-checks.ts";
import { type PageBox } from "./layer9-probes.ts";

export interface StackingFacts { trackZ: number; stripZ: number; labelBackground: string; line: PageBox | null; label: PageBox | null; isBarOnTop: boolean }

const WAIT_MS = 15_000;
const TRANSPARENT_PATTERN = /transparent|rgba\(.*,\s*0\)$/;
const SELECT_SESSION = `document.querySelector('.session-item').click()`;
const CLEAR_SESSIONS = `document.getElementById('clear-sessions').click()`;
// The first strip line whose instant equals a session record's instant, then the bar's hit test at its centre.
export const STACKING_FACTS =`(async () => {
    const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const zOf = id => Number(getComputedStyle(document.getElementById(id)).zIndex);
    let line = null;
    let label = null;
    for (const candidate of document.querySelectorAll('#jfred-strip .jline'))
        for (const text of document.querySelectorAll('#annotation-track .alabel'))
            if (label === null && Date.parse(text.dataset.instant) === Date.parse(candidate.dataset.instant)) { line = candidate; label = text; }
    const facts = { trackZ: zOf('annotation-track'), stripZ: zOf('jfred-strip'), labelBackground: label ? getComputedStyle(label).backgroundColor : '',
        line: line ? box(line) : null, label: label ? box(label) : null };
    const bar = document.querySelector('.range');
    bar.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise(resolve => setTimeout(resolve, 150));
    const at = bar.getBoundingClientRect();
    return { ...facts, isBarOnTop: document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2) === bar };
})()`;

export function isLineBehindText(facts: StackingFacts): boolean {
  if (facts.line === null || facts.label === null)
    return false;
  const isOpaque = facts.labelBackground !== "" && !TRANSPARENT_PATTERN.test(facts.labelBackground);
  return facts.trackZ > facts.stripZ && isOpaque && isIntersecting(facts.line, facts.label) && facts.isBarOnTop;
}

export async function validateLineBehindText(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await page.evaluate(SELECT_SESSION);
  await page.waitFor(`document.querySelectorAll('.range').length > 0 && ${STRIP_IDLE}`, WAIT_MS);
  const facts = await page.evaluate<StackingFacts>(STACKING_FACTS);
  reportCheck("L9 the dashed line runs behind the session text: column above the strip, opaque label, line crosses it, bar still on top", isLineBehindText(facts), facts);
  await page.evaluate(CLEAR_SESSIONS);
  await page.waitFor(`document.querySelectorAll('.range').length === 0 && ${STRIP_IDLE}`, WAIT_MS);
  await page.evaluate(SCROLL_HOME);
}

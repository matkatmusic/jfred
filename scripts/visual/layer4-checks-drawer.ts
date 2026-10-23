// Layer 4 script-run drawer layout checks: status badges, affected-file list, and word-wrap.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

const BADGE_TITLES = ["not verified", "located", "not replayed"];

// Expects the python script-run drawer to be open.
export async function checkScriptRunDrawerLayout(page: HeadlessPage): Promise<void> {
  const drawer = await page.evaluate<{
    badgeTitles: string[]; metaText: string; panePaths: string[]; metaTerms: string[];
    preWhiteSpace: string; preOverflowY: string; preOverflows: boolean; dlWhiteSpace: string;
  }>(`(() => {
        const pre = document.querySelector('#drawer .scriptbody pre');
        const meta = document.querySelector('#drawer dl.script-meta');
        return {
            badgeTitles: [...document.querySelectorAll('#dpath .run-status')].map(s => s.title),
            metaText: document.getElementById('dmeta').textContent,
            panePaths: [...document.querySelectorAll('#dbody details.dfile .dfile-path')].map(p => p.dataset.target),
            metaTerms: [...meta.querySelectorAll('dt')].map(t => t.textContent),
            preWhiteSpace: getComputedStyle(pre).whiteSpace,
            preOverflowY: getComputedStyle(pre).overflowY,
            preOverflows: pre.scrollWidth > pre.clientWidth,
            dlWhiteSpace: getComputedStyle(meta).whiteSpace };
    })()`);
  reportCheck("L4 python dot: dpath holds 3 run-status badges with their titles",
    JSON.stringify(drawer.badgeTitles) === JSON.stringify(BADGE_TITLES), drawer.badgeTitles);
  reportCheck("L4 python dot: dmeta lists every affected path",
    drawer.panePaths.length > 0 && drawer.panePaths.every((path) => drawer.metaText.includes(path)), drawer);
  reportCheck("L4 python dot: the script-meta list has no files row", !drawer.metaTerms.includes("files"), drawer.metaTerms);
  reportCheck("L4 python dot: the script body wraps (pre-wrap) with no horizontal overflow",
    drawer.preWhiteSpace === "pre-wrap" && !drawer.preOverflows, drawer);
  reportCheck("L4 python dot: the script body scrolls vertically (overflow-y auto)", drawer.preOverflowY === "auto", drawer.preOverflowY);
  reportCheck("L4 python dot: the script-meta list wraps (white-space normal)", drawer.dlWhiteSpace === "normal", drawer.dlWhiteSpace);
}

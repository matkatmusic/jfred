// Layer 4 script-run drawer layout checks: status badges, affected-file list, and word-wrap.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";

const BADGE_TITLES = ["not verified", "located", "not replayed"];
const PYTHON_RUN_ID = "toolu_fixture_py_rewrite";
const PYTHON_RUN_LINE = 83;

// Expects the python script-run drawer to be open.
export async function checkScriptRunDrawerLayout(page: HeadlessPage): Promise<void> {
  const drawer = await page.evaluate<{
    badgeTitles: string[]; titleText: string; metaText: string; panePaths: string[]; metaTerms: string[];
    preWhiteSpace: string; preOverflowY: string; preOverflows: boolean; dlWhiteSpace: string;
    metaRows: string[]; prov: string; hljsSpans: number; titleLabel: string; nodeLabel: string;
  }>(`(() => {
        const pre = document.querySelector('#drawer .scriptbody pre');
        const meta = document.querySelector('#drawer dl.script-meta');
        return {
            badgeTitles: [...document.querySelectorAll('#dpath .run-status')].map(s => s.title),
            titleText: document.getElementById('dpath').textContent,
            metaText: document.getElementById('dmeta').textContent,
            panePaths: [...document.querySelectorAll('#dbody details.dfile .dfile-path')].map(p => p.dataset.target),
            metaTerms: [...meta.querySelectorAll('dt')].map(t => t.textContent),
            metaRows: [...meta.querySelectorAll('dt')].map(t => t.textContent + '=' + t.nextElementSibling.textContent),
            prov: document.querySelector('#drawer .scriptbody .prov').textContent,
            hljsSpans: pre.querySelectorAll('span[class^="hljs-"]').length,
            titleLabel: document.getElementById('dpath').firstChild.textContent,
            nodeLabel: document.querySelector('.nlabel.n-script[data-tool-use-id="' + ${JSON.stringify(PYTHON_RUN_ID)} + '"]').textContent,
            preWhiteSpace: getComputedStyle(pre).whiteSpace,
            preOverflowY: getComputedStyle(pre).overflowY,
            preOverflows: pre.scrollWidth > pre.clientWidth,
            dlWhiteSpace: getComputedStyle(meta).whiteSpace };
    })()`);
  reportCheck("L4 python dot: dpath holds 3 run-status badges with their titles",
    JSON.stringify(drawer.badgeTitles) === JSON.stringify(BADGE_TITLES), drawer.badgeTitles);
  reportCheck("L4 python dot: dpath reads Verified: ❌, Located: ✅, Replayed: ❌ with no 📍/⏸️/🚫",
    ["Verified: ❌", "Located: ✅", "Replayed: ❌"].every((text) => drawer.titleText.includes(text)) && !/[📍⏸🚫]/u.test(drawer.titleText), drawer.titleText);
  reportCheck("L4 python dot: dmeta lists every affected path",
    drawer.panePaths.length > 0 && drawer.panePaths.every((path) => drawer.metaText.includes(path)), drawer);
  reportCheck("L4 python dot: the script-meta list has no files row", !drawer.metaTerms.includes("files"), drawer.metaTerms);
  reportCheck("L4 python dot: the script body wraps (pre-wrap) with no horizontal overflow",
    drawer.preWhiteSpace === "pre-wrap" && !drawer.preOverflows, drawer);
  reportCheck("L4 python dot: the script body scrolls vertically (overflow-y auto)", drawer.preOverflowY === "auto", drawer.preOverflowY);
  reportCheck("L4 python dot: the script-meta list wraps (white-space normal)", drawer.dlWhiteSpace === "normal", drawer.dlWhiteSpace);
  reportCheck("L4 python dot: script-meta shows the line and the tool use id",
    drawer.metaRows.includes(`line=${PYTHON_RUN_LINE}`) && drawer.metaRows.includes(`tool use id=${PYTHON_RUN_ID}`), drawer.metaRows);
  reportCheck("L4 python dot: the provenance head names the line and the tool use id",
    drawer.prov.includes(`line ${PYTHON_RUN_LINE}`) && drawer.prov.includes(PYTHON_RUN_ID), drawer.prov);
  reportCheck("L4 python dot: the python script body holds hljs token spans", drawer.hljsSpans > 0, drawer.hljsSpans);
  reportCheck("L4 python dot: the node label and the drawer title read python run rewrite.py",
    drawer.nodeLabel === "python run rewrite.py" && drawer.titleLabel === "python run rewrite.py", drawer);
}

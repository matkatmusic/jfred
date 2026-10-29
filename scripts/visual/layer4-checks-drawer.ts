// Layer 4 script-run drawer checks: open the drawer, status badges, affected-file list, word-wrap, per-dot drawers.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { PYTHON_RUN_ID, bashDot, connector, pythonDots } from "./layer4-probes.ts";

const BADGE_TITLES = ["not verified", "located", "not replayed"];
const STATUS_TEXTS = ["Verified: ❌", "Located: ✅", "Replayed: ❌"];
const PICTOGRAPH_PATTERN = /[📍⏸🚫]/u;
const PYTHON_RUN_LINE = 83;
const PYTHON_SESSION_FILE = "0f3c9a7e.jsonl";
const DRAWER_TIMEOUT_MS = 10_000;

function containsAll(text: string, parts: string[]): boolean {
  let hasAll = true;
  for (const part of parts) {
    const hasPart = text.includes(part);
    if (!hasPart)
      hasAll = false;
  }
  return hasAll;
}

// Expects the python script-run drawer to be open.
export async function validateScriptRunDrawerLayout(page: HeadlessPage): Promise<void> {
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
  const hasPictographs = PICTOGRAPH_PATTERN.test(drawer.titleText);
  reportCheck("L4 python dot: dpath holds 3 run-status badges with their titles",
    JSON.stringify(drawer.badgeTitles) === JSON.stringify(BADGE_TITLES), drawer.badgeTitles);
  reportCheck("L4 python dot: dpath reads Verified: ❌, Located: ✅, Replayed: ❌ with no 📍/⏸️/🚫",
    containsAll(drawer.titleText, STATUS_TEXTS) && !hasPictographs, drawer.titleText);
  reportCheck("L4 python dot: dmeta lists every affected path",
    drawer.panePaths.length > 0 && containsAll(drawer.metaText, drawer.panePaths), drawer);
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

// Clears the drawer, runs the click, waits for the script body and at least one diff pane.
async function openScriptDrawer(page: HeadlessPage, click: string): Promise<void> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren();
        document.getElementById('dpath').textContent = '';
        document.getElementById('drawer').classList.remove('open');
        ${click}`);
  await page.waitFor(
    `document.getElementById('drawer').classList.contains('open')
        && document.querySelector('#drawer .scriptbody pre')?.textContent.length > 0
        && document.querySelectorAll('#dbody details.dfile').length > 0`,
    DRAWER_TIMEOUT_MS);
}

const readDrawer = (page: HeadlessPage) => page.evaluate<{
  path: string; metaText: string; preText: string; hasHead: boolean; panes: number;
}>(`({
        path: document.getElementById('dpath').firstChild.textContent.trim(),
        metaText: document.querySelector('#drawer dl.script-meta')?.textContent ?? '',
        preText: document.querySelector('#drawer .scriptbody pre')?.textContent ?? '',
        hasHead: document.querySelector('#drawer .scriptbody .sbhead') !== null,
        panes: document.querySelectorAll('#dbody details.dfile').length })`);

export async function validatePythonDrawer(page: HeadlessPage): Promise<string> {
  await openScriptDrawer(page, `${pythonDots}[0].click()`);
  const drawer = await readDrawer(page);
  reportCheck("L4 python dot: the drawer path names rewrite.py", drawer.path.includes("rewrite.py"), drawer.path);
  await validateScriptRunDrawerLayout(page);
  reportCheck("L4 python dot: the script body has a head and shows import pathlib",
    drawer.hasHead && drawer.preText.includes("import pathlib"), drawer);
  reportCheck("L4 python dot: the drawer holds 2 diff panes", drawer.panes === 2, drawer.panes);
  await page.waitFor(`document.querySelector('.session-item.flash')?.dataset.file === '${PYTHON_SESSION_FILE}'`, DRAWER_TIMEOUT_MS);
  reportCheck(`L4 python dot: the owning JSONL ${PYTHON_SESSION_FILE} flashes`,
    await page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`) === PYTHON_SESSION_FILE);
  await saveScreenshot(page, "08-layer4-drawer");
  return drawer.preText;
}

export async function validateConnectorDrawer(page: HeadlessPage, pythonPath: string, pythonPre: string): Promise<void> {
  await openScriptDrawer(page, `${connector}.click()`);
  const drawer = await readDrawer(page);
  reportCheck("L4 connector click: the same drawer path and script text as the python dot",
    drawer.path === pythonPath && drawer.preText === pythonPre, drawer.path);
}

export async function validateBashDrawer(page: HeadlessPage): Promise<void> {
  await openScriptDrawer(page, `${bashDot}.click()`);
  const drawer = await readDrawer(page);
  reportCheck("L4 bash dot: the drawer path reads bash run", drawer.path === "bash run", drawer.path);
  reportCheck("L4 bash dot: the script body is not empty", drawer.preText.trim().length > 0, drawer.preText);
  reportCheck("L4 bash dot: the drawer holds 1 diff pane", drawer.panes === 1, drawer.panes);
}

// Task 355: ticks the Edit box on the real server and checks the page against the real /api/layer1-edits payload.

import { WireConfidence, WireEditKind, type WireEditsView } from "../../webapp/layer1-wire-edits.ts";
import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const EDIT_BOX = `document.querySelector('#show-row input[data-kind="edit"]')`;
const COUNT_EDIT_NODES = `document.querySelectorAll('i.node.n-edit, i.node.n-read').length`;
const COUNT_EDIT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-edits')).length`;
const SHIELD_HIDDEN = `document.getElementById('busy-shield').hidden`;
const DRAWER_TIMEOUT_MS = 20_000;

// Installed before the tick: records the shield, the strip, the counter labels and the click-through test.
const WATCH_BUSY = `(() => {
    window.__busy = { shieldShown: false, stripShown: false, labels: [], blocked: null };
    const shield = document.getElementById('busy-shield');
    new MutationObserver(() => {
        if (shield.hidden) return;
        window.__busy.shieldShown = true;
        const box = [...document.querySelectorAll('.filebox')].find(b => {
            const r = b.getBoundingClientRect();
            return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        });
        if (box === undefined || window.__busy.blocked !== null) return;
        const r = box.getBoundingClientRect();
        const x = (Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2;
        const y = (Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2;
        const hit = document.elementFromPoint(x, y);
        window.__busy.blocked = hit !== null && hit.closest('#busy-shield') !== null;
    }).observe(shield, { attributes: true, attributeFilter: ['hidden'] });
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__busy.stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
    const label = document.getElementById('busy-label');
    new MutationObserver(() => window.__busy.labels.push(label.textContent))
        .observe(label, { childList: true, characterData: true, subtree: true });
})()`;

const buildNodeByChangeId = (changeId: string) =>
  `document.querySelector('i.node[data-change-id=${JSON.stringify(changeId)}]')`;

const readFlashFile = (page: HeadlessPage) =>
  page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`);

async function listViewPaths(page: HeadlessPage): Promise<Set<string>> {
  const paths = await page.evaluate<string[]>(`[...document.querySelectorAll('.fname[data-path]')].map(n => n.dataset.path)`);
  return new Set(paths);
}

function listEditsOnPaths(payload: WireEditsView, paths: Set<string>): WireEditsView["pairs"][number]["edits"] {
  return payload.pairs.filter((pair) => paths.has(pair.path)).flatMap((pair) => pair.edits);
}

async function openNode(page: HeadlessPage, dot: string): Promise<void> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren(); ${dot}.click()`);
  await page.waitFor(
    `document.getElementById('drawer').classList.contains('open') && document.querySelectorAll('#dbody .diff-line').length > 0`,
    DRAWER_TIMEOUT_MS);
}

async function checkBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("#355 before the box: no Edit or Read node is drawn", await page.evaluate<number>(COUNT_EDIT_NODES) === 0);
  reportCheck("#355 before the box: no /api/layer1-edits request yet", await page.evaluate<number>(COUNT_EDIT_REQUESTS) === 0);
}

async function checkFirstFetch(page: HeadlessPage, payload: WireEditsView, fetchTimeoutMs: number): Promise<void> {
  const viewPaths = await listViewPaths(page);
  const expectedNodes = listEditsOnPaths(payload, viewPaths).length;
  await page.evaluate(WATCH_BUSY);
  await page.evaluate(`${EDIT_BOX}.click()`);
  await page.waitFor(`${COUNT_EDIT_NODES} > 0 && ${SHIELD_HIDDEN}`, fetchTimeoutMs);
  const busy = await page.evaluate<{ shieldShown: boolean; stripShown: boolean; labels: string[]; blocked: boolean | null }>(`window.__busy`);
  reportCheck("#355 the blocking shield shows during the fetch", busy.shieldShown);
  reportCheck("#355 the shield label counts n / m", busy.labels.some((text) => /\d+ \/ \d+/.test(text)), busy.labels.slice(-3));
  reportCheck("#355 while the shield shows, a click on a file box hits the shield", busy.blocked === true, busy.blocked);
  reportCheck("#355 the loadbar strip shows during the fetch", busy.stripShown);
  reportCheck("#355 the shield is hidden once the payload lands", await page.evaluate<boolean>(SHIELD_HIDDEN));
  const requests = await page.evaluate<number>(COUNT_EDIT_REQUESTS);
  reportCheck("#355 exactly one /api/layer1-edits request", requests === 1, requests);
  const drawn = await page.evaluate<number>(COUNT_EDIT_NODES);
  reportCheck("#355 the node count equals the payload edit count on drawn paths", drawn === expectedNodes, { drawn, expectedNodes });
}

async function checkConfidences(page: HeadlessPage, payload: WireEditsView): Promise<void> {
  const drawn = await page.evaluate<[string, string][]>(
    `[...document.querySelectorAll('i.node.n-edit, i.node.n-read')].map(n => [n.dataset.changeId, n.dataset.confidence])`);
  const wire = new Map(payload.pairs.flatMap((pair) => pair.edits).map((edit) => [edit.changeId, edit.confidence]));
  const mismatched = drawn.filter(([changeId, confidence]) => wire.get(changeId!) !== confidence);
  reportCheck("#355 every node's confidence equals the payload's", drawn.length > 0 && mismatched.length === 0, mismatched.slice(0, 3));
}

async function checkToggle(page: HeadlessPage): Promise<void> {
  const counts = await page.evaluate<{ off: number; on: number }>(`(() => {
        const box = ${EDIT_BOX};
        const visible = () => [...document.querySelectorAll('i.node.n-edit, i.node.n-read')]
            .filter(n => getComputedStyle(n).display !== 'none').length;
        box.click();
        const off = visible();
        box.click();
        return { off, on: visible() };
    })()`);
  reportCheck("#355 untick hides every Edit node, tick shows them again", counts.off === 0 && counts.on > 0, counts);
  reportCheck("#355 toggling afterwards adds no request", await page.evaluate<number>(COUNT_EDIT_REQUESTS) === 1);
}

async function checkVerifiedEdit(page: HeadlessPage): Promise<void> {
  const dot = `document.querySelector('i.node.n-edit.conf-verified[data-kind="${WireEditKind.edit}"]')`;
  const found = await page.evaluate<boolean>(`${dot} !== null`);
  reportCheck("#355 the page draws a verified Edit node", found);
  await openNode(page, dot);
  const drawer = await page.evaluate<{ meta: string; rows: number; file: string }>(`({
        meta: document.getElementById('dmeta').textContent,
        rows: document.querySelectorAll('#dbody .diff-line').length,
        file: ${dot}.dataset.sessionFile.split('/').pop() })`);
  reportCheck("#355 the verified edit opens a non-empty diff that says verified", drawer.rows > 0 && drawer.meta.includes("verified"), drawer);
  await page.waitFor(`document.querySelector('.session-item.flash')?.dataset.file === ${JSON.stringify(drawer.file)}`, DRAWER_TIMEOUT_MS);
  reportCheck("#355 the owning JSONL flashes", await readFlashFile(page) === drawer.file, drawer.file);
  await page.waitFor(`document.querySelector('#dbody .json-toggle') !== null`, DRAWER_TIMEOUT_MS);
  await page.evaluate(`document.querySelector('#dbody .json-toggle').click()`);
  const json = await page.evaluate<boolean>(`document.querySelector('#dbody .node-json').textContent.includes('structuredPatch')`);
  reportCheck("#355 the { } reveal shows structuredPatch", json);
}

async function checkUncertainEdit(page: HeadlessPage, payload: WireEditsView): Promise<void> {
  const uncertain = payload.pairs.flatMap((pair) => pair.edits).find((edit) => edit.confidence !== WireConfidence.verified);
  if (uncertain === undefined) {
    console.log("SKIP  #355 no derived or reseeded edit in the payload");
    return;
  }
  await openNode(page, buildNodeByChangeId(uncertain.changeId));
  const meta = await page.evaluate<string>(`document.getElementById('dmeta').textContent`);
  reportCheck(`#355 the drawer for a ${uncertain.confidence} edit says so, not verified`,
    meta.includes(uncertain.confidence) && !meta.includes(WireConfidence.verified), meta);
}

export async function executeLayer3RealChecks(
  page: HeadlessPage, payload: WireEditsView, fetchTimeoutMs: number, screenshotName: string,
): Promise<void> {
  await checkBeforeTick(page);
  await checkFirstFetch(page, payload, fetchTimeoutMs);
  await checkConfidences(page, payload);
  await checkToggle(page);
  await checkVerifiedEdit(page);
  await checkUncertainEdit(page, payload);
  await saveScreenshot(page, screenshotName);
}

// Task 343: the drawer checks of S20's Verify list: verified edit, derived edit and Read beacon.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { DISPATCHER_PATH, DRAWER_TIMEOUT_MS, INDEX_PATH, UTIL_PATH, buildDotFinder } from "./layer3-probes.ts";

async function openNode(page: HeadlessPage, dot: string): Promise<void> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren(); ${dot}.click()`);
  await page.waitFor(
    `document.getElementById('drawer').classList.contains('open') && document.querySelectorAll('#dbody .diff-line').length > 0`,
    DRAWER_TIMEOUT_MS);
}

const readFlashFile = (page: HeadlessPage) =>
  page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`);

export async function assertVerifiedEdit(page: HeadlessPage): Promise<void> {
  const verifiedUtil = buildDotFinder(UTIL_PATH, "n-edit", `d.dataset.sessionFile.endsWith('b21d84c5.jsonl')`);
  await openNode(page, verifiedUtil);
  const drawer = await page.evaluate<{ meta: string; added: string; removed: number }>(`({
        meta: document.getElementById('dmeta').textContent,
        added: [...document.querySelectorAll('#dbody .diff-line.add')].map(l => l.textContent).join('\\n'),
        removed: document.querySelectorAll('#dbody .diff-line.del').length })`);
  reportCheck("#343 clicking the util.ts verified edit: the drawer says verified", drawer.meta.includes("verified"), drawer.meta);
  reportCheck("#343 the diff shows the added line and a removed line", drawer.added.includes("// edited") && drawer.removed > 0, drawer);
  await page.waitFor(`document.querySelector('.session-item.flash')?.dataset.file === 'b21d84c5.jsonl'`, DRAWER_TIMEOUT_MS);
  reportCheck("#343 the owning JSONL b21d84c5.jsonl flashes", await readFlashFile(page) === "b21d84c5.jsonl");
  await page.waitFor(`document.querySelector('#dbody .json-toggle') !== null`, DRAWER_TIMEOUT_MS);
  await page.evaluate(`document.querySelector('#dbody .json-toggle').click()`);
  await page.waitFor(`document.querySelector('#dbody .node-json').textContent !== ''`, DRAWER_TIMEOUT_MS);
  const json =await page.evaluate<{ shown: boolean; hasPatch: boolean; hasChangeId: boolean }>(`(box => ({
        shown: !box.hidden, hasPatch: box.textContent.includes('structuredPatch'),
        hasChangeId: box.textContent.includes(${verifiedUtil}.dataset.changeId) }))
        (document.querySelector('#dbody .node-json'))`);
  reportCheck("#343 the { } button shows the raw record with its structuredPatch and changeId",
    json.shown && json.hasPatch && json.hasChangeId, json);
  await openNode(page, buildDotFinder(UTIL_PATH, "n-edit", `d.dataset.sessionFile.endsWith('d4a06b8f.jsonl')`));
  await page.waitFor(`document.querySelector('.session-item.flash')?.dataset.file === 'd4a06b8f.jsonl'`, DRAWER_TIMEOUT_MS);
  reportCheck("#343 the second util.ts edit flashes its own JSONL d4a06b8f.jsonl", await readFlashFile(page) === "d4a06b8f.jsonl");
}

export async function assertDerivedEdit(page: HeadlessPage): Promise<void> {
  const derivedDot = buildDotFinder(DISPATCHER_PATH, "n-edit", `d.dataset.confidence === 'derived'`);
  const traits = await page.evaluate<{ isFound: boolean; ring: string; verifiedRing: string }>(`({
        isFound: ${derivedDot} !== undefined && ${derivedDot}.classList.contains('conf-derived')
            && ${derivedDot}.dataset.confidence === 'derived',
        ring: (s => s.outlineStyle + '/' + s.borderStyle)(getComputedStyle(${derivedDot})),
        verifiedRing: (s => s.outlineStyle + '/' + s.borderStyle)(getComputedStyle(${buildDotFinder(UTIL_PATH, "n-edit")})) })`);
  reportCheck("#343 the stale dispatcher edit node is .conf-derived", traits.isFound, traits);
  reportCheck("#343 the derived ring differs from the verified ring", traits.ring !== traits.verifiedRing, traits);
  await openNode(page, derivedDot);
  const meta = await page.evaluate<string>(`document.getElementById('dmeta').textContent`);
  reportCheck("#343 the drawer for the stale edit says derived, not verified",
    meta.includes("derived") && !meta.includes("verified"), meta);
  await saveScreenshot(page, "06-layer3-derived");
}

export async function assertReadBeacon(page: HeadlessPage): Promise<void> {
  const readDot = buildDotFinder(INDEX_PATH, "n-read");
  await openNode(page, readDot);
  const shown = await page.evaluate<{ bytesLine: string; body: string }>(`(async () => {
        const dot = ${readDot};
        const params = new URLSearchParams({ editChangeId: dot.dataset.changeId, side: 'target', path: ${JSON.stringify(INDEX_PATH)}, dir: document.getElementById('dir').value.trim() });
        const content = (await (await fetch('/api/layer1-file?' + params)).json()).content;
        return { bytesLine: content.split('\\n').find(l => l.trim().length > 3),
            body: document.getElementById('dbody').textContent };
    })()`);
  reportCheck("#343 clicking a [R]✓ node shows the beacon bytes", shown.body.includes(shown.bytesLine), shown.bytesLine);
}

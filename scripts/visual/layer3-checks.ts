// Task 343: S20's Verify list on the fixture-mode page; mockup.ts calls checkLayer3 and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

const UTIL_PATH = "src/util.ts";
const INDEX_PATH = "src/index.ts";
const README_PATH = "README.md";
const DISPATCHER_PATH = "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts";
const DRAWER_TIMEOUT_MS = 10_000;

const EDIT_BOX = `document.querySelector('#show-row input[data-kind="edit"]')`;
const COUNT_EDIT_DOTS = `document.querySelectorAll('i.node.n-edit, i.node.n-read').length`;
const COUNT_TICKS = `document.querySelectorAll('.ruler .tick').length`;
const COUNT_EDIT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-edits')).length`;
const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
const WATCH_STRIP = `(() => {
    window.__stripShown = false;
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
})()`;

// The first dot of this class inside the path's bubble that passes `test`, as a page expression.
export const buildDotFinder = (path: string, dotClass: string, test = "true") =>
  `([...document.querySelector('.fname[data-path=${JSON.stringify(path)}]').closest('.filebox')
        .querySelectorAll('i.node.${dotClass}')].find(d => ${test}))`;

// A bubble's node rows by class and label, offsets left out.
const buildRowsProbe = (path: string) =>
  `[...document.querySelector('.fname[data-path=${JSON.stringify(path)}]').closest('.filebox')
        .querySelectorAll('.node, .nlabel')].map(n => n.className + ':' + n.textContent).join('|')`;

// True when a ruler tick starting with `tickText` sits level with the dot's centre.
const buildRulerMatchProbe = (dot: string, tickText: string) => `(d => {
    const box = d.getBoundingClientRect();
    return [...document.querySelectorAll('.ruler .tick')].some(t => {
        const row = t.getBoundingClientRect();
        return t.textContent.startsWith(${JSON.stringify(tickText)})
            && Math.abs(row.top + row.height / 2 - (box.top + box.height / 2)) <= 2;
    });
})(${dot})`;

const buildToggleProbe = (dot: string) => `(() => {
    const box = ${EDIT_BOX};
    const shown = () => getComputedStyle(${dot}).display !== 'none';
    box.click();
    const afterUntick = shown();
    box.click();
    const afterTick = shown();
    box.click();
    return { afterUntick, afterTick, afterSecondUntick: shown() };
})()`;

const buildTokenColour = (token: string) => `(() => {
    const probe = document.createElement('i');
    probe.style.background = 'var(${token})';
    document.querySelector('.viz-root').append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
})()`;

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

// Runs `trigger`, waits out the fetch and the redraw, then reports the strip, the one request and the box.
async function checkFirstFetch(page: HeadlessPage, label: string, trigger: string): Promise<number> {
  await page.evaluate(WATCH_STRIP);
  const ticksBefore = await page.evaluate<number>(COUNT_TICKS);
  await page.evaluate(trigger);
  await page.waitFor(`${COUNT_EDIT_DOTS} > 0 && ${STRIP_IDLE}`, 15_000);
  reportCheck(`#343 ${label}: the progress strip shows during the fetch`,
    await page.evaluate<boolean>(`window.__stripShown`));
  const requests = await page.evaluate<number>(COUNT_EDIT_REQUESTS);
  reportCheck(`#343 ${label}: exactly one /api/layer1-edits request`, requests === 1, requests);
  reportCheck(`#343 ${label}: the Edit box reads checked`, await page.evaluate<boolean>(`${EDIT_BOX}.checked`));
  return ticksBefore;
}

async function openNode(page: HeadlessPage, dot: string): Promise<void> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren(); ${dot}.click()`);
  await page.waitFor(
    `document.getElementById('drawer').classList.contains('open') && document.querySelectorAll('#dbody .diff-line').length > 0`,
    DRAWER_TIMEOUT_MS);
}

const readFlashFile = (page: HeadlessPage) =>
  page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`);

async function checkBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("#343 before the box: no Edit or Read node is drawn",
    await page.evaluate<number>(COUNT_EDIT_DOTS) === 0);
  reportCheck("#343 before the box: the Edit box exists and is unchecked",
    await page.evaluate<boolean>(`${EDIT_BOX} !== null && ${EDIT_BOX}.checked === false`));
  reportCheck("#343 before the box: no /api/layer1-edits request yet",
    await page.evaluate<number>(COUNT_EDIT_REQUESTS) === 0);
}

async function checkRuler(page: HeadlessPage, ticksBefore: number): Promise<void> {
  const ticksAfter = await page.evaluate<number>(COUNT_TICKS);
  reportCheck("#343 the ruler grew to include the new instants", ticksAfter > ticksBefore, { ticksBefore, ticksAfter });
  const crafted: [string, string, string][] = [
    [UTIL_PATH, "06-01 14:15:00", "n-edit"],
    [DISPATCHER_PATH, "06-03 09:10:00", "n-edit"],
    [INDEX_PATH, "06-01 08:46:00", "n-read"],
  ];
  for (const [path, tickText, dotClass] of crafted) {
    reportCheck(`#343 the ruler holds ${tickText} level with the ${dotClass} node in ${path.split("/").pop()}`,
      await page.evaluate<boolean>(buildRulerMatchProbe(buildDotFinder(path, dotClass), tickText)));
  }
}

async function checkInstantToggle(page: HeadlessPage): Promise<void> {
  const toggled = await page.evaluate<{ afterUntick: boolean; afterTick: boolean; afterSecondUntick: boolean }>(
    buildToggleProbe(buildDotFinder(UTIL_PATH, "n-edit")));
  reportCheck("#343 untick hides Edit nodes, tick shows them, in one synchronous run",
    !toggled.afterUntick && toggled.afterTick && !toggled.afterSecondUntick, toggled);
  reportCheck("#343 toggling afterwards adds no request",
    await page.evaluate<number>(COUNT_EDIT_REQUESTS) === 1);
}

async function checkNodeLook(page: HeadlessPage): Promise<void> {
  const labels = await page.evaluate<{ edit: string[]; read: string[] }>(`({
        edit: [...document.querySelectorAll('i.node.n-edit + .nlabel')].map(l => l.textContent),
        read: [...document.querySelectorAll('i.node.n-read + .nlabel')].map(l => l.textContent) })`);
  reportCheck("#343 every Edit node reads [e]", labels.edit.length > 0 && labels.edit.every((text) => text === "[e]"), labels.edit.slice(0, 3));
  reportCheck("#343 every Read beacon reads [R]✓", labels.read.length > 0 && labels.read.every((text) => text === "[R]✓"), labels.read.slice(0, 3));
  const colours = await page.evaluate<{ edit: string; read: string; editToken: string; readToken: string }>(`({
        edit: getComputedStyle(${buildDotFinder(UTIL_PATH, "n-edit")}).backgroundColor,
        read: getComputedStyle(${buildDotFinder(UTIL_PATH, "n-read")}).backgroundColor,
        editToken: ${buildTokenColour("--c-edit")}, readToken: ${buildTokenColour("--c-read")} })`);
  reportCheck("#343 Edit and Read dots use the Edit and Read token colours",
    colours.edit === colours.editToken && colours.read === colours.readToken && colours.edit !== colours.read, colours);
}

async function checkVerifiedEdit(page: HeadlessPage): Promise<void> {
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
  const json = await page.evaluate<{ shown: boolean; hasPatch: boolean; hasChangeId: boolean }>(`(box => ({
        shown: !box.hidden, hasPatch: box.textContent.includes('structuredPatch'),
        hasChangeId: box.textContent.includes(${verifiedUtil}.dataset.changeId) }))
        (document.querySelector('#dbody .node-json'))`);
  reportCheck("#343 the { } button shows the raw record with its structuredPatch and changeId",
    json.shown && json.hasPatch && json.hasChangeId, json);
  await openNode(page, buildDotFinder(UTIL_PATH, "n-edit", `d.dataset.sessionFile.endsWith('d4a06b8f.jsonl')`));
  await page.waitFor(`document.querySelector('.session-item.flash')?.dataset.file === 'd4a06b8f.jsonl'`, DRAWER_TIMEOUT_MS);
  reportCheck("#343 the second util.ts edit flashes its own JSONL d4a06b8f.jsonl", await readFlashFile(page) === "d4a06b8f.jsonl");
}

async function checkDerivedEdit(page: HeadlessPage): Promise<void> {
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

async function checkReadBeacon(page: HeadlessPage): Promise<void> {
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

export async function checkLayer3(page: HeadlessPage, pageUrl: string): Promise<void> {
  await checkBeforeTick(page);
  const readmeBefore = await page.evaluate<string>(buildRowsProbe(README_PATH));
  const ticksBefore = await checkFirstFetch(page, "ticking the Edit box", `${EDIT_BOX}.click()`);
  await checkRuler(page, ticksBefore);
  reportCheck("#343 a pair with no Layer 3 events renders as before",
    await page.evaluate<string>(buildRowsProbe(README_PATH)) === readmeBefore, readmeBefore);
  await checkInstantToggle(page);

  await waitForFreshPage(page, pageUrl);
  await checkFirstFetch(page, "the [3] button", `document.getElementById('layer-3').click()`);
  await checkNodeLook(page);
  await saveScreenshot(page, "05-layer3-on");
  await checkVerifiedEdit(page);
  await checkDerivedEdit(page);
  await checkReadBeacon(page);

  await waitForFreshPage(page, pageUrl);
}

// Layer 4 (script-run nodes) checks on the fixture-mode page; mockup.ts calls checkLayer4 and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { BUBBLES, reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { checkScriptRunDrawerLayout } from "./layer4-checks-drawer.ts";

const UTIL_PATH = "src/util.ts";
const INDEX_PATH = "src/index.ts";
const PYTHON_RUN_ID = "toolu_fixture_py_rewrite";
const BASH_RUN_ID = "toolu_fixture_sh_inline";
const PYTHON_SESSION_FILE = "0f3c9a7e.jsonl";
const DRAWER_TIMEOUT_MS = 10_000;

const SCRIPT_BOX = `document.querySelector('#show-row input[data-kind="script-run"]')`;
const EDIT_BOX = `document.querySelector('#show-row input[data-kind="edit"]')`;
const SCRIPT_DOTS = `document.querySelectorAll('i.node.n-script')`;
const COUNT_SCRIPT_DOTS = `${SCRIPT_DOTS}.length`;
const COUNT_EDIT_DOTS = `document.querySelectorAll('i.node.n-edit, i.node.n-read').length`;
const COUNT_TICKS = `document.querySelectorAll('.ruler .tick').length`;
const COUNT_SCRIPT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-script-runs')).length`;
const COUNT_EDIT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-edits')).length`;
const STRIP_IDLE = `document.getElementById('loadbar').hidden`;
const WATCH_STRIP = `(() => {
    window.__stripShown = false;
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
})()`;

const pythonDots = `[...document.querySelectorAll('i.node.n-script[data-tool-use-id="${PYTHON_RUN_ID}"]')]`;
const pythonLabels = `[...document.querySelectorAll('.nlabel.n-script[data-tool-use-id="${PYTHON_RUN_ID}"]')]`;
const bashDot = `document.querySelector('i.node.n-script[data-tool-use-id="${BASH_RUN_ID}"]')`;
const bashLabel = `document.querySelector('.nlabel.n-script[data-tool-use-id="${BASH_RUN_ID}"]')`;
const connector = `document.querySelector('#stage .script-connector[data-tool-use-id="${PYTHON_RUN_ID}"]')`;
const bubblePathOf = (dot: string) => `${dot}.closest('.filebox').querySelector('.fname[data-path]').dataset.path`;

// True when some ruler tick sits level with the dot's centre.
const buildRulerMatchProbe = (dot: string) => `(d => {
    const box = d.getBoundingClientRect();
    return [...document.querySelectorAll('.ruler .tick')].some(t => {
        const row = t.getBoundingClientRect();
        return Math.abs(row.top + row.height / 2 - (box.top + box.height / 2)) <= 2;
    });
})(${dot})`;

// Reads whether the dots, the labels and the connector are all visible, after each of three clicks on the box.
const buildToggleProbe = () => `(() => {
    const box = ${SCRIPT_BOX};
    const parts = () => [...${SCRIPT_DOTS}, ...document.querySelectorAll('.nlabel.n-script, .script-connector')];
    const state = () => { const seen = parts().map(p => getComputedStyle(p).visibility); return { count: seen.length, visible: seen.every(v => v === 'visible'), hidden: seen.every(v => v === 'hidden') }; };
    box.click();
    const afterUntick = state();
    box.click();
    const afterTick = state();
    box.click();
    const afterSecondUntick = state();
    box.click();
    return { afterUntick, afterTick, afterSecondUntick, endsTicked: box.checked };
})()`;

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

async function checkBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("L4 before the box: no script-run node is drawn", await page.evaluate<number>(COUNT_SCRIPT_DOTS) === 0);
  reportCheck("L4 before the box: the script-run box exists and is unchecked",
    await page.evaluate<boolean>(`${SCRIPT_BOX} !== null && ${SCRIPT_BOX}.checked === false`));
  reportCheck("L4 before the box: no /api/layer1-script-runs request yet",
    await page.evaluate<number>(COUNT_SCRIPT_REQUESTS) === 0);
}

async function checkTickFetch(page: HeadlessPage): Promise<void> {
  await page.evaluate(WATCH_STRIP);
  const ticksBefore = await page.evaluate<number>(COUNT_TICKS);
  await page.evaluate(`${SCRIPT_BOX}.click()`);
  await page.waitFor(`${COUNT_SCRIPT_DOTS} > 0 && ${STRIP_IDLE}`, 15_000);
  reportCheck("L4 ticking the script-run box: the progress strip shows during the fetch",
    await page.evaluate<boolean>(`window.__stripShown`));
  const requests = await page.evaluate<number>(COUNT_SCRIPT_REQUESTS);
  reportCheck("L4 ticking the script-run box: exactly one /api/layer1-script-runs request", requests === 1, requests);
  reportCheck("L4 ticking the script-run box: the box reads checked", await page.evaluate<boolean>(`${SCRIPT_BOX}.checked`));
  const dotCount = await page.evaluate<number>(COUNT_SCRIPT_DOTS);
  reportCheck("L4 ticking the script-run box: exactly 3 script nodes", dotCount === 3, dotCount);
  const ticksAfter = await page.evaluate<number>(COUNT_TICKS);
  reportCheck("L4 the ruler grew to include the script-run instants", ticksAfter > ticksBefore, { ticksBefore, ticksAfter });
  const levelFlags = await page.evaluate<boolean[]>(
    `[...${SCRIPT_DOTS}].map(d => ${buildRulerMatchProbe("d")})`);
  reportCheck("L4 every script node sits level with a ruler tick", levelFlags.length === 3 && levelFlags.every(Boolean), levelFlags);
}

async function checkInstantToggle(page: HeadlessPage): Promise<void> {
  const toggled = await page.evaluate<{
    afterUntick: { count: number; visible: boolean; hidden: boolean };
    afterTick: { count: number; visible: boolean; hidden: boolean };
    afterSecondUntick: { count: number; visible: boolean; hidden: boolean };
    endsTicked: boolean;
  }>(buildToggleProbe());
  reportCheck("L4 untick hides script nodes, labels and connector with visibility, tick shows them, in one synchronous run",
    toggled.afterUntick.hidden && toggled.afterTick.visible && toggled.afterSecondUntick.hidden && toggled.afterTick.count === 7, toggled);
  reportCheck("L4 the toggle run ends with the box ticked", toggled.endsTicked);
  reportCheck("L4 toggling afterwards adds no request", await page.evaluate<number>(COUNT_SCRIPT_REQUESTS) === 1);
}

async function checkNodeLook(page: HeadlessPage): Promise<void> {
  const look = await page.evaluate<{
    pythonNodeCount: number; pythonBubbles: string[]; pythonLabels: string[]; pythonRings: string[];
    bashLabel: string | undefined; bashClass: boolean; bashRing: string | undefined; bashBubble: string | undefined;
    kinds: string[];
  }>(`({
        pythonNodeCount: ${pythonDots}.length,
        pythonBubbles: ${pythonDots}.map(d => ${bubblePathOf("d")}),
        pythonLabels: ${pythonLabels}.map(l => l.textContent),
        pythonRings: ${pythonDots}.map(d => getComputedStyle(d).borderStyle),
        bashLabel: ${bashLabel}?.textContent,
        bashClass: ${bashDot}?.classList.contains('never-provable') ?? false,
        bashRing: (d => d && getComputedStyle(d).borderStyle)(${bashDot}),
        bashBubble: (d => d && ${bubblePathOf("d")})(${bashDot}),
        kinds: [...${SCRIPT_DOTS}].map(d => d.dataset.executorKind) })`);
  reportCheck("L4 the python run has 2 nodes in 2 different bubbles, one of them src/index.ts",
    look.pythonNodeCount === 2 && new Set(look.pythonBubbles).size === 2 && look.pythonBubbles.includes(INDEX_PATH), look.pythonBubbles);
  reportCheck("L4 each python label reads 🐍 rewrite.py",
    look.pythonLabels.length === 2 && look.pythonLabels.every((text) => text === "🐍 rewrite.py"), look.pythonLabels);
  reportCheck("L4 each python ring is solid", look.pythonRings.length === 2 && look.pythonRings.every((style) => style === "solid"), look.pythonRings);
  reportCheck("L4 the bash run has 1 node in the src/util.ts bubble", look.bashBubble === UTIL_PATH, look.bashBubble);
  reportCheck("L4 the bash label reads exactly $", look.bashLabel === "$", look.bashLabel);
  reportCheck("L4 the bash dot has .never-provable and a dashed ring", look.bashClass && look.bashRing === "dashed", look);
  reportCheck("L4 executor kinds are python, python, bash", [...look.kinds].sort().join(",") === "bash,python,python", look.kinds);
}

async function checkConnector(page: HeadlessPage): Promise<void> {
  const shape = await page.evaluate<{
    count: number; total: number; centreDeltaY: number; leftDelta: number; rightDelta: number;
  }>(`(() => {
        const dots = ${pythonDots}.map(d => d.getBoundingClientRect());
        const line = ${connector}?.getBoundingClientRect();
        const centres = dots.map(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
        const xs = centres.map(c => c.x);
        return {
            count: document.querySelectorAll('#stage .script-connector[data-tool-use-id="${PYTHON_RUN_ID}"]').length,
            total: document.querySelectorAll('.script-connector').length,
            centreDeltaY: line ? Math.max(...centres.map(c => Math.abs(line.top + line.height / 2 - c.y))) : 99999,
            leftDelta: line ? Math.abs(line.left - Math.min(...xs)) : 99999,
            rightDelta: line ? Math.abs(line.right - Math.max(...xs)) : 99999 };
    })()`);
  reportCheck("L4 exactly one python connector in #stage, and none for the bash run", shape.count === 1 && shape.total === 1, shape);
  reportCheck("L4 the connector is level with both python dots (within 2px)", shape.centreDeltaY <= 2, shape);
  reportCheck("L4 the connector spans from one dot centre to the other (within 3px)",
    shape.leftDelta <= 3 && shape.rightDelta <= 3, shape);
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

async function checkPythonDrawer(page: HeadlessPage): Promise<string> {
  await openScriptDrawer(page, `${pythonDots}[0].click()`);
  const drawer = await readDrawer(page);
  reportCheck("L4 python dot: the drawer path names rewrite.py", drawer.path.includes("rewrite.py"), drawer.path);
  await checkScriptRunDrawerLayout(page);
  reportCheck("L4 python dot: the script body has a head and shows import pathlib",
    drawer.hasHead && drawer.preText.includes("import pathlib"), drawer);
  reportCheck("L4 python dot: the drawer holds 2 diff panes", drawer.panes === 2, drawer.panes);
  await page.waitFor(`document.querySelector('.session-item.flash')?.dataset.file === '${PYTHON_SESSION_FILE}'`, DRAWER_TIMEOUT_MS);
  reportCheck(`L4 python dot: the owning JSONL ${PYTHON_SESSION_FILE} flashes`,
    await page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`) === PYTHON_SESSION_FILE);
  await saveScreenshot(page, "08-layer4-drawer");
  return drawer.preText;
}

async function checkConnectorDrawer(page: HeadlessPage, pythonPath: string, pythonPre: string): Promise<void> {
  await openScriptDrawer(page, `${connector}.click()`);
  const drawer = await readDrawer(page);
  reportCheck("L4 connector click: the same drawer path and script text as the python dot",
    drawer.path === pythonPath && drawer.preText === pythonPre, drawer.path);
}

async function checkBashDrawer(page: HeadlessPage): Promise<void> {
  await openScriptDrawer(page, `${bashDot}.click()`);
  const drawer = await readDrawer(page);
  reportCheck("L4 bash dot: the drawer path reads bash run", drawer.path === "bash run", drawer.path);
  reportCheck("L4 bash dot: the script body is not empty", drawer.preText.trim().length > 0, drawer.preText);
  reportCheck("L4 bash dot: the drawer holds 1 diff pane", drawer.panes === 1, drawer.panes);
}

async function checkPairWithoutRun(page: HeadlessPage): Promise<void> {
  const quietBubbles = await page.evaluate<number[]>(
    `[...document.querySelectorAll(${JSON.stringify(BUBBLES)})].map(b => b.querySelectorAll('.n-script').length).filter(n => n === 0)`);
  reportCheck("L4 at least one pair has no script run and draws 0 script nodes", quietBubbles.length > 0, quietBubbles.length);
}

async function checkLayerButton(page: HeadlessPage): Promise<void> {
  await page.evaluate(`document.getElementById('layer-4').click()`);
  await page.waitFor(`${COUNT_SCRIPT_DOTS} > 0 && ${COUNT_EDIT_DOTS} > 0 && ${STRIP_IDLE}`, 15_000);
  const result = await page.evaluate<{ edits: number; scriptRuns: number; editBox: boolean; scriptBox: boolean; dots: number }>(`({
        edits: ${COUNT_EDIT_REQUESTS}, scriptRuns: ${COUNT_SCRIPT_REQUESTS},
        editBox: ${EDIT_BOX}.checked, scriptBox: ${SCRIPT_BOX}.checked, dots: ${COUNT_SCRIPT_DOTS} })`);
  reportCheck("L4 the [4] button: one /api/layer1-edits and one /api/layer1-script-runs request",
    result.edits === 1 && result.scriptRuns === 1, result);
  reportCheck("L4 the [4] button: both the Edit box and the script-run box read checked", result.editBox && result.scriptBox, result);
  reportCheck("L4 the [4] button: exactly 3 script nodes", result.dots === 3, result.dots);
}

export async function checkLayer4(page: HeadlessPage, pageUrl: string): Promise<void> {
  await checkBeforeTick(page);
  await checkTickFetch(page);
  await checkInstantToggle(page);
  await checkNodeLook(page);
  await saveScreenshot(page, "07-layer4-nodes");
  await checkConnector(page);
  const pythonPre = await checkPythonDrawer(page);
  const pythonPath = await page.evaluate<string>(`document.getElementById('dpath').firstChild.textContent.trim()`);
  await checkConnectorDrawer(page, pythonPath, pythonPre);
  await checkBashDrawer(page);
  await checkPairWithoutRun(page);

  await waitForFreshPage(page, pageUrl);
  await checkLayerButton(page);

  await waitForFreshPage(page, pageUrl);
}

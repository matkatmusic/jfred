// Task l4-wire-real: ticks the script-run box on the real server and checks the page against the real /api/layer1-script-runs payload.

import { type WireScriptRunsView } from "../../webapp/layer1-wire-script-runs.ts";
import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { checkFirstNodeScroll } from "./layer4-first-node-checks.ts";

const PYTHON_BY_INDIRECTION_RUN_ID = "toolu_01LfaBokYE3WzerLLSTycdNV";
const PYTHON_BY_INDIRECTION_PATHS = ["common/scripts/git_lib.py", "tests/test_git_lib.py"];
const NEVER_PROVABLE_RUN_ID = "toolu_01Ms5XvMy6ihtbg2xGqwstGz";
const NEVER_PROVABLE_PATH = "skills/debate/tests/archive/test.sh";
const DRAWER_TIMEOUT_MS = 60_000;

const SCRIPT_BOX = `document.querySelector('#show-row input[data-kind="script-run"]')`;
const COUNT_SCRIPT_NODES = `document.querySelectorAll('i.node.n-script').length`;
const COUNT_SCRIPT_REQUESTS =
  `performance.getEntriesByType('resource').filter(e => e.name.includes('/api/layer1-script-runs')).length`;
const SHIELD_HIDDEN = `document.getElementById('busy-shield').hidden`;

const WATCH_BUSY = `(() => {
    window.__busy = { shieldShown: false, stripShown: false, labels: [] };
    const shield = document.getElementById('busy-shield');
    new MutationObserver(() => { if (!shield.hidden) window.__busy.shieldShown = true; })
        .observe(shield, { attributes: true, attributeFilter: ['hidden'] });
    const bar = document.getElementById('loadbar');
    new MutationObserver(() => { if (!bar.hidden) window.__busy.stripShown = true; })
        .observe(bar, { attributes: true, attributeFilter: ['hidden'] });
    const label = document.getElementById('busy-label');
    new MutationObserver(() => window.__busy.labels.push(label.textContent))
        .observe(label, { childList: true, characterData: true, subtree: true });
})()`;

const buildDotsOfRun = (toolUseId: string) =>
  `[...document.querySelectorAll('i.node.n-script[data-tool-use-id=${JSON.stringify(toolUseId)}]')]`;
const buildConnectorOfRun = (toolUseId: string) =>
  `document.querySelector('#stage .script-connector[data-tool-use-id=${JSON.stringify(toolUseId)}]')`;
const bubblePathOf = (dot: string) => `${dot}.closest('.filebox').querySelector('.fname[data-path]').dataset.path`;

async function listViewPaths(page: HeadlessPage): Promise<Set<string>> {
  const paths = await page.evaluate<string[]>(`[...document.querySelectorAll('.fname[data-path]')].map(n => n.dataset.path)`);
  return new Set(paths);
}

function listRunsOnPaths(payload: WireScriptRunsView, paths: Set<string>): WireScriptRunsView["pairs"][number]["scriptRuns"] {
  return payload.pairs.filter((pair) => paths.has(pair.path)).flatMap((pair) => pair.scriptRuns);
}

async function checkBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("l4-wire-real before the box: no script-run node is drawn", await page.evaluate<number>(COUNT_SCRIPT_NODES) === 0);
  reportCheck("l4-wire-real before the box: no /api/layer1-script-runs request yet", await page.evaluate<number>(COUNT_SCRIPT_REQUESTS) === 0);
}

async function checkFirstFetch(page: HeadlessPage, payload: WireScriptRunsView, fetchTimeoutMs: number): Promise<void> {
  const expectedNodes = listRunsOnPaths(payload, await listViewPaths(page)).length;
  await page.evaluate(WATCH_BUSY);
  await page.evaluate(`${SCRIPT_BOX}.click()`);
  await page.waitFor(`${COUNT_SCRIPT_REQUESTS} === 1 && ${SHIELD_HIDDEN}`, fetchTimeoutMs);
  const busy = await page.evaluate<{ shieldShown: boolean; stripShown: boolean; labels: string[] }>(`window.__busy`);
  reportCheck("l4-wire-real the blocking shield shows during the fetch", busy.shieldShown);
  reportCheck("l4-wire-real the loadbar strip shows during the fetch", busy.stripShown);
  reportCheck("l4-wire-real the shield label counts n / m", busy.labels.some((text) => /\d+ \/ \d+/.test(text)), busy.labels.slice(-3));
  reportCheck("l4-wire-real the shield is hidden once the payload lands", await page.evaluate<boolean>(SHIELD_HIDDEN));
  reportCheck("l4-wire-real exactly one /api/layer1-script-runs request", await page.evaluate<number>(COUNT_SCRIPT_REQUESTS) === 1);
  const drawn = await page.evaluate<number>(COUNT_SCRIPT_NODES);
  reportCheck("l4-wire-real the node count equals the payload run count on drawn paths", drawn === expectedNodes, { drawn, expectedNodes });
}

async function openScriptDrawer(page: HeadlessPage, click: string): Promise<{ path: string; body: string }> {
  await page.evaluate(`document.getElementById('dbody').replaceChildren();
        document.getElementById('drawer').classList.remove('open');
        ${click}`);
  await page.waitFor(
    `document.getElementById('drawer').classList.contains('open') && document.querySelector('#drawer .scriptbody pre')?.textContent.length > 0`,
    DRAWER_TIMEOUT_MS);
  return await page.evaluate<{ path: string; body: string }>(
    `({ path: document.getElementById('dpath').textContent.trim(), body: document.querySelector('#drawer .scriptbody pre').textContent })`);
}

async function checkIndirectionExample(page: HeadlessPage, payload: WireScriptRunsView): Promise<void> {
  const wire = payload.pairs.flatMap((pair) => pair.scriptRuns).find((run) => run.toolUseId === PYTHON_BY_INDIRECTION_RUN_ID);
  reportCheck("l4-wire-real example A is in the payload", wire !== undefined);
  const bubbles = await page.evaluate<string[]>(`${buildDotsOfRun(PYTHON_BY_INDIRECTION_RUN_ID)}.map(d => ${bubblePathOf("d")})`);
  reportCheck("l4-wire-real example A has a node on both of its pairs",
    PYTHON_BY_INDIRECTION_PATHS.every((path) => bubbles.includes(path)), bubbles);
  const connectors = await page.evaluate<number>(
    `document.querySelectorAll('#stage .script-connector[data-tool-use-id=${JSON.stringify(PYTHON_BY_INDIRECTION_RUN_ID)}]').length`);
  reportCheck("l4-wire-real example A has exactly one connector", connectors === 1, connectors);
  const neverProvable = await page.evaluate<boolean>(`${buildDotsOfRun(PYTHON_BY_INDIRECTION_RUN_ID)}[0].classList.contains('never-provable')`);
  reportCheck("l4-wire-real example A is python and not never-provable", !neverProvable && wire?.executorKind === "python");
  const drawer = await openScriptDrawer(page, `${buildDotsOfRun(PYTHON_BY_INDIRECTION_RUN_ID)}[0].click()`);
  const firstCodeLine = (wire?.code ?? "").split("\n").find((line) => line.trim() !== "") ?? "";
  reportCheck("l4-wire-real example A drawer shows the resolved .py body, not the python3 line",
    !drawer.body.trimStart().startsWith("python3") && drawer.body.includes(firstCodeLine), drawer.body.slice(0, 120));
  const viaConnector = await openScriptDrawer(page, `${buildConnectorOfRun(PYTHON_BY_INDIRECTION_RUN_ID)}.click()`);
  reportCheck("l4-wire-real example A connector opens the same drawer", viaConnector.path === drawer.path && viaConnector.body === drawer.body);
}

async function checkNeverProvableExample(page: HeadlessPage): Promise<void> {
  const bubbles = await page.evaluate<string[]>(`${buildDotsOfRun(NEVER_PROVABLE_RUN_ID)}.map(d => ${bubblePathOf("d")})`);
  reportCheck("l4-wire-real example B has a node on its pair", bubbles.includes(NEVER_PROVABLE_PATH), bubbles);
  const neverProvable = await page.evaluate<boolean>(`${buildDotsOfRun(NEVER_PROVABLE_RUN_ID)}[0].classList.contains('never-provable')`);
  reportCheck("l4-wire-real example B node has .never-provable", neverProvable);
}

async function checkToggle(page: HeadlessPage): Promise<void> {
  await page.evaluate(`${SCRIPT_BOX}.click(); ${SCRIPT_BOX}.click()`);
  reportCheck("l4-wire-real untick then re-tick adds no request", await page.evaluate<number>(COUNT_SCRIPT_REQUESTS) === 1);
}

export async function executeLayer4RealChecks(
  page: HeadlessPage, payload: WireScriptRunsView, fetchTimeoutMs: number, screenshotName: string, isJot: boolean,
): Promise<void> {
  await checkBeforeTick(page);
  await checkFirstFetch(page, payload, fetchTimeoutMs);
  if (isJot) {
    await checkIndirectionExample(page, payload);
    await checkNeverProvableExample(page);
  }
  await checkToggle(page);
  await saveScreenshot(page, screenshotName);
  await checkFirstNodeScroll(page);
}

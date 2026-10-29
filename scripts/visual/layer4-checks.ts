// Layer 4 (script-run nodes) checks on the fixture-mode page; mockup.ts calls validateLayer4 and it leaves a fresh page behind.

import { type HeadlessPage } from "./cdp.ts";
import { BUBBLES, reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { validateBashDrawer, validateConnectorDrawer, validatePythonDrawer } from "./layer4-checks-drawer.ts";
import {
  COUNT_EDIT_DOTS, COUNT_EDIT_REQUESTS, COUNT_SCRIPT_DOTS, COUNT_SCRIPT_REQUESTS, COUNT_TICKS, EDIT_BOX, PYTHON_RUN_ID,
  SCRIPT_BOX, SCRIPT_DOTS, STRIP_IDLE, WATCH_STRIP, bashDot, bashLabel, buildBubblePathExpression, buildRulerMatchProbe,
  buildToggleProbe, connector, pythonDots, pythonLabels,
} from "./layer4-probes.ts";

const UTIL_PATH = "src/util.ts";
const INDEX_PATH = "src/index.ts";
const PYTHON_LABEL = "python run rewrite.py";

async function waitForFreshPage(page: HeadlessPage, pageUrl: string): Promise<void> {
  await page.navigate(pageUrl);
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}

async function validateBeforeTick(page: HeadlessPage): Promise<void> {
  reportCheck("L4 before the box: no script-run node is drawn", await page.evaluate<number>(COUNT_SCRIPT_DOTS) === 0);
  reportCheck("L4 before the box: the script-run box exists and is unchecked",
    await page.evaluate<boolean>(`${SCRIPT_BOX} !== null && ${SCRIPT_BOX}.checked === false`));
  reportCheck("L4 before the box: no /api/layer1-script-runs request yet",
    await page.evaluate<number>(COUNT_SCRIPT_REQUESTS) === 0);
}

async function validateTickFetch(page: HeadlessPage): Promise<void> {
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
  const allLevel = !levelFlags.includes(false);
  reportCheck("L4 every script node sits level with a ruler tick", levelFlags.length === 3 && allLevel, levelFlags);
}

async function validateInstantToggle(page: HeadlessPage): Promise<void> {
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

async function validateNodeLook(page: HeadlessPage): Promise<void> {
  const look = await page.evaluate<{
    pythonNodeCount: number; pythonBubbles: string[]; pythonLabels: string[]; pythonRings: string[];
    bashLabel: string | undefined; bashClass: boolean; bashRing: string | undefined; bashBubble: string | undefined;
    kinds: string[];
  }>(`({
        pythonNodeCount: ${pythonDots}.length,
        pythonBubbles: ${pythonDots}.map(d => ${buildBubblePathExpression("d")}),
        pythonLabels: ${pythonLabels}.map(l => l.textContent),
        pythonRings: ${pythonDots}.map(d => getComputedStyle(d).borderStyle),
        bashLabel: ${bashLabel}?.textContent,
        bashClass: ${bashDot}?.classList.contains('never-provable') ?? false,
        bashRing: (d => d && getComputedStyle(d).borderStyle)(${bashDot}),
        bashBubble: (d => d && ${buildBubblePathExpression("d")})(${bashDot}),
        kinds: [...${SCRIPT_DOTS}].map(d => d.dataset.executorKind) })`);
  const labelsMatch = JSON.stringify(look.pythonLabels) === JSON.stringify([PYTHON_LABEL, PYTHON_LABEL]);
  const solidRings = JSON.stringify(look.pythonRings) === JSON.stringify(["solid", "solid"]);
  reportCheck("L4 the python run has 2 nodes in 2 different bubbles, one of them src/index.ts",
    look.pythonNodeCount === 2 && new Set(look.pythonBubbles).size === 2 && look.pythonBubbles.includes(INDEX_PATH), look.pythonBubbles);
  reportCheck("L4 each python label reads python run rewrite.py", labelsMatch, look.pythonLabels);
  reportCheck("L4 each python ring is solid", solidRings, look.pythonRings);
  reportCheck("L4 the bash run has 1 node in the src/util.ts bubble", look.bashBubble === UTIL_PATH, look.bashBubble);
  reportCheck("L4 the bash label reads exactly bash run", look.bashLabel === "bash run", look.bashLabel);
  reportCheck("L4 the bash dot has .never-provable and a dashed ring", look.bashClass && look.bashRing === "dashed", look);
  reportCheck("L4 executor kinds are python, python, bash", [...look.kinds].sort().join(",") === "bash,python,python", look.kinds);
}

async function validateConnector(page: HeadlessPage): Promise<void> {
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

async function validatePairWithoutRun(page: HeadlessPage): Promise<void> {
  const quietBubbles = await page.evaluate<number[]>(
    `[...document.querySelectorAll(${JSON.stringify(BUBBLES)})].map(b => b.querySelectorAll('.n-script').length).filter(n => n === 0)`);
  reportCheck("L4 at least one pair has no script run and draws 0 script nodes", quietBubbles.length > 0, quietBubbles.length);
}

async function validateLayerButton(page: HeadlessPage): Promise<void> {
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

export async function validateLayer4(page: HeadlessPage, pageUrl: string): Promise<void> {
  await validateBeforeTick(page);
  await validateTickFetch(page);
  await validateInstantToggle(page);
  await validateNodeLook(page);
  await saveScreenshot(page, "07-layer4-nodes");
  await validateConnector(page);
  const pythonPre = await validatePythonDrawer(page);
  const pythonPath = await page.evaluate<string>(`document.getElementById('dpath').firstChild.textContent.trim()`);
  await validateConnectorDrawer(page, pythonPath, pythonPre);
  await validateBashDrawer(page);
  await validatePairWithoutRun(page);

  await waitForFreshPage(page, pageUrl);
  await validateLayerButton(page);

  await waitForFreshPage(page, pageUrl);
}

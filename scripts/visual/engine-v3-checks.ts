// engineV3 mockup checks on the fixture-mode page: buttons are clicked by their on-screen labels, results are DOM counts.

import { type HeadlessPage, waitMilliseconds } from "./cdp.ts";
import { openSessionColumn } from "./layer7-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { EngineV3StepKind, type WireEngineV3Step, type WireEngineV3Steps } from "../../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";
import type { WireRulerTick } from "../../webapp/layer1-wire.ts";

const BAR = `document.getElementById('engine-v3-bar')`;
const PAGE_WAIT_MS = 30_000;
const SCROLL_SETTLE_MS = 500;
const MAX_CLICKS = 1000;
// In bar order, as the user reads them.
export const BUTTON_LABELS = ["Start over", "Jump to previous commit", "Step backwards", "Step forward", "Jump to next commit"] as const;
type ButtonLabel = (typeof BUTTON_LABELS)[number];
const buildVisibleButtonFinder = (labelExpression: string) => `[...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === ${labelExpression} && candidate.offsetParent !== null)`;
export const STEPS_LOADED = `${BAR}.dataset.markerIndex !== undefined`;
export const FETCH_STEPS = `fetch('/api/layer1-engine-v3-steps').then((response) => response.json())`;
export const COUNT_SESSION_NODES = `document.querySelectorAll('#annotation-track i.anode.current-node').length`;
export const COUNT_COMMIT_NODES = `document.querySelectorAll('i.node.n-commit.current-node').length`;
export const READ_COMMIT_HASHES = `[...new Set([...document.querySelectorAll('i.node.n-commit.current-node')].map((node) => node.title))].join(',')`;
export const READ_CURRENT_NODE_ID = `document.querySelector('#annotation-track i.anode.current-node')?.dataset.recordId ?? ''`;
export const READ_MARKER_INDEX = `${BAR}.dataset.markerIndex`;
export const READ_SENTENCE = `document.getElementById('engine-v3-sentence').textContent`;
export const READ_OFF_FLAGS = `${JSON.stringify(BUTTON_LABELS)}.map((label) => (${buildVisibleButtonFinder("label")}).disabled ? '1' : '0').join('')`;
export const READ_TRACK_COUNT = `document.querySelectorAll('#annotation-track').length`;
export const FETCH_RULER = `fetch('/api/layer1-view').then((response) => response.json()).then((view) => view.ruler)`;
const CANVAS_TOP = `document.querySelector('.canvas').getBoundingClientRect().top`;
export const READ_LINE_FACTS = `(() => {
  const line = document.getElementById('engine-v3-line');
  if (!line || line.hidden) return null;
  const laneY = parseFloat(getComputedStyle(document.querySelector('.canvas')).getPropertyValue('--lane-y'));
  return { top: line.getBoundingClientRect().top - ${CANVAS_TOP}, laneY };
})()`;
export const READ_LINE_IN_VIEW = `(() => {
  const line = document.getElementById('engine-v3-line');
  const pane = document.getElementById('timelines').getBoundingClientRect();
  const box = line.getBoundingClientRect();
  return !line.hidden && box.top >= pane.top && box.bottom <= pane.bottom;
})()`;
export const buildReadLeaderTop = (axisPx: number) => `(() => {
  const leader = [...document.querySelectorAll('#leaders .leader')].find((candidate) => Number(candidate.style.getPropertyValue('--axis-px')) === ${axisPx});
  return leader ? leader.getBoundingClientRect().top - ${CANVAS_TOP} : null;
})()`;
export const CLOSE_DRAWER =`document.getElementById('dclose').click()`;
export const buildClickButtonByLabel = (label: string) => `(() => {
  const button = ${buildVisibleButtonFinder(JSON.stringify(label))};
  if (!button) throw new Error('no visible button labelled ${label}');
  button.click();
})()`;
export const buildClickLabelWhileOn = (label: string) => `(() => {
  const button = ${buildVisibleButtonFinder(JSON.stringify(label))};
  for (let click = 0; click < ${MAX_CLICKS} && !button.disabled; click += 1) button.click();
})()`;
export const buildClickNode = (nodeId: string) => `(() => {
  const node = document.querySelector('#annotation-track i.anode[data-record-id="${nodeId}"]');
  if (!node) throw new Error('Session column node ${nodeId} is not drawn');
  node.click();
})()`;

interface LineFacts {
  top: number;
  laneY: number;
}

interface MarkerFacts {
  sessionCount: number;
  commitCount: number;
  commitHashes: string;
  sessionNodeId: string;
  markerIndex: string;
  sentence: string;
  offFlags: string;
}

async function readMarkerFacts(page: HeadlessPage): Promise<MarkerFacts> {
  return {
    sessionCount: await page.evaluate<number>(COUNT_SESSION_NODES),
    commitCount: await page.evaluate<number>(COUNT_COMMIT_NODES),
    commitHashes: await page.evaluate<string>(READ_COMMIT_HASHES),
    sessionNodeId: await page.evaluate<string>(READ_CURRENT_NODE_ID),
    markerIndex: await page.evaluate<string>(READ_MARKER_INDEX),
    sentence: await page.evaluate<string>(READ_SENTENCE),
    offFlags: await page.evaluate<string>(READ_OFF_FLAGS),
  };
}

function containsCommitAfter(steps: readonly WireEngineV3Step[], index: number): boolean {
  for (const step of steps.slice(index + 1)) {
    if (step.kind === EngineV3StepKind.commit) {
      return true;
    }
  }
  return false;
}

function formatOffFlags(flags: readonly boolean[]): string {
  let text = "";
  for (const isOff of flags) {
    text += isOff ? "1" : "0";
  }
  return text;
}

// The five off flags in button order, derived from the rules the user gave, not from the page.
function computeExpectedOffFlags(steps: readonly WireEngineV3Step[], index: number): string {
  const isFirst = index === 0;
  return formatOffFlags([isFirst, isFirst, isFirst, index === steps.length - 1, !containsCommitAfter(steps, index)]);
}

function findLastCommitIndex(steps: readonly WireEngineV3Step[]): number {
  let lastCommitIndex = 0;
  for (const [index, step] of steps.entries()) {
    if (step.kind === EngineV3StepKind.commit) {
      lastCommitIndex = index;
    }
  }
  return lastCommitIndex;
}

function reportMarkerAt(title: string, facts: MarkerFacts, steps: readonly WireEngineV3Step[], index: number): void {
  const step = steps[index]!;
  const isCommit = step.kind === EngineV3StepKind.commit;
  const isMarkedRight = isCommit
    ? facts.sessionCount === 0 && facts.commitCount >= 1 && facts.commitHashes === step.nodeId
    : facts.commitCount === 0 && facts.sessionCount === 1 && facts.sessionNodeId === step.nodeId;
  reportCheck(`engineV3 ${title}: the marker index is ${index}`, facts.markerIndex === String(index), facts);
  reportCheck(`engineV3 ${title}: only step ${index}'s ${isCommit ? "commit" : "Session"} node is marked`, isMarkedRight, { facts, step });
  reportCheck(`engineV3 ${title}: the readout says step ${index}'s sentence`, facts.sentence === step.sentence, { facts, step });
  reportCheck(`engineV3 ${title}: the off flags are right`, facts.offFlags === computeExpectedOffFlags(steps, index), { facts });
}

async function executeClickAndCheck(page: HeadlessPage, steps: WireEngineV3Steps, label: ButtonLabel, expectedIndex: number): Promise<void> {
  await page.evaluate(buildClickButtonByLabel(label));
  reportMarkerAt(`${label} gives step ${expectedIndex}`, await readMarkerFacts(page), steps.steps, expectedIndex);
}

function findAxisPx(ruler: readonly WireRulerTick[], nodeTime: string): number {
  for (const tick of ruler) {
    const isStepTime = Date.parse(tick.instant) === Date.parse(nodeTime);
    if (isStepTime) {
      return tick.axisPx;
    }
  }
  throw new Error(`the ruler has no tick at ${nodeTime}`);
}

async function reportLineAt(page: HeadlessPage, title: string, steps: WireEngineV3Steps, ruler: readonly WireRulerTick[], index: number): Promise<void> {
  const facts = await page.evaluate<LineFacts | null>(READ_LINE_FACTS);
  const axisPx = findAxisPx(ruler, steps.steps[index]!.nodeTime);
  const leaderTop = await page.evaluate<number | null>(buildReadLeaderTop(axisPx));
  reportCheck(`engineV3 ${title}: the line exists`, facts !== null, facts);
  const isOnLeader = facts !== null && leaderTop !== null && Math.abs(facts.top - leaderTop) <= 2 && Math.abs(facts.top - (axisPx + facts.laneY)) <= 2;
  reportCheck(`engineV3 ${title}: the line y is within 2px of step ${index}'s ruler y`, isOnLeader, { facts, leaderTop, axisPx });
}

async function reportLineInView(page: HeadlessPage, title: string): Promise<void> {
  await waitMilliseconds(SCROLL_SETTLE_MS);
  const isInView = await page.evaluate<boolean>(READ_LINE_IN_VIEW);
  reportCheck(`engineV3 ${title}: the line is inside the visible timeline area`, isInView, isInView);
}

// The Session column is still off here: the line must not need its dots.
async function validateLineWithSessionOff(page: HeadlessPage, steps: WireEngineV3Steps): Promise<void> {
  const ruler = await page.evaluate<WireRulerTick[]>(FETCH_RULER);
  const trackCount = await page.evaluate<number>(READ_TRACK_COUNT);
  reportCheck("engineV3 session off: no Session column track is drawn", trackCount === 0, trackCount);
  await reportLineAt(page, "session off, at load", steps, ruler, 0);
  await page.evaluate(buildClickLabelWhileOn("Jump to next commit"));
  await reportLineAt(page, "session off, after Jump to next commit", steps, ruler, findLastCommitIndex(steps.steps));
  await reportLineInView(page, "session off, after Jump to next commit");
  await page.evaluate(buildClickButtonByLabel("Start over"));
  await reportLineAt(page, "session off, after Start over", steps, ruler, 0);
}

async function readEngineV3Steps(page: HeadlessPage): Promise<WireEngineV3Steps> {
  await page.waitFor(STEPS_LOADED, PAGE_WAIT_MS);
  const steps = await page.evaluate<WireEngineV3Steps>(FETCH_STEPS);
  reportCheck("engineV3 the route starts with a commit step", steps.steps[0]?.kind === EngineV3StepKind.commit, steps.steps[0]);
  return steps;
}

// Fixture list: step 0 commit, steps 1 and 2 Session, step 3 next commit.
async function validateStepButtons(page: HeadlessPage, steps: WireEngineV3Steps): Promise<void> {
  reportMarkerAt("at load", await readMarkerFacts(page), steps.steps, 0);
  await executeClickAndCheck(page, steps, "Step forward", 1);
  await executeClickAndCheck(page, steps, "Step forward", 2);
  await executeClickAndCheck(page, steps, "Step backwards", 1);
  await executeClickAndCheck(page, steps, "Jump to next commit", 3);
  await executeClickAndCheck(page, steps, "Jump to previous commit", 0);
  await executeClickAndCheck(page, steps, "Step forward", 1);
  await executeClickAndCheck(page, steps, "Start over", 0);
}

async function validateNodeClickAndEnds(page: HeadlessPage, steps: WireEngineV3Steps): Promise<void> {
  await page.evaluate(buildClickNode(steps.steps[4]!.nodeId));
  reportMarkerAt("click node 4", await readMarkerFacts(page), steps.steps, 4);
  await page.evaluate(buildClickLabelWhileOn("Jump to next commit"));
  reportMarkerAt("Jump to next commit until off", await readMarkerFacts(page), steps.steps, findLastCommitIndex(steps.steps));
  await page.evaluate(buildClickLabelWhileOn("Step forward"));
  reportMarkerAt("Step forward until off", await readMarkerFacts(page), steps.steps, steps.steps.length - 1);
}

export async function validateEngineV3Mockup(page: HeadlessPage): Promise<void> {
  const steps = await readEngineV3Steps(page);
  await validateLineWithSessionOff(page, steps);
  await openSessionColumn(page);
  await validateStepButtons(page, steps);
  await validateNodeClickAndEnds(page, steps);
  await page.evaluate(CLOSE_DRAWER);
}

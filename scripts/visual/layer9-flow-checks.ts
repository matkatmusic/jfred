// Layer 9 flow checks: ordinary clicks, Commit mode paint, refusals, marks and Commit.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck } from "./mockup-checks.ts";
import { REQUEST_COUNT } from "./layer7-probes.ts";
import {
  COMMIT_CLICK, COMMIT_MODE_CLICK, CutClass, FOOTNOTE_PREFIX, MARK_FACTS, MODE_STATE, STRIP_COUNT, TICKFILES_COUNT, TICK_LABELS, TICK_STATES, YESNO_NO, YESNO_YES,
  buildBeaconInstantCount, buildClickTick, buildRefusalClick, type MarkFacts, type RefusalFacts, type TickState,
} from "./layer9-probes.ts";
import { CUT_REFUSAL_TEXT, CutRefusal } from "../../webapp/layer1-components/commits-column/layer1-cut-rules.ts";
import { JfredEntryKind } from "../../webapp/layer1-components/commits-column/layer1-jfred-entries.ts";

const REFUSAL_CASES: [string, CutRefusal][] = [
  [TICK_LABELS.createdOnly, CutRefusal.noVerifiedNode], [TICK_LABELS.derivedOnly, CutRefusal.noVerifiedNode],
  [TICK_LABELS.behindTip, CutRefusal.notForward], [TICK_LABELS.atTip, CutRefusal.notForward],
];

const UNCHANGED_NEXT_INSTANT_PREFIX = "2026-06-03T18:20:00";
const YESNO_ROW_FACTS = `({ rows: document.querySelectorAll('#yesno-row').length, text: document.getElementById('yesno-row')?.textContent ?? '' })`;

interface YesNoRowFacts { rows: number; text: string }

const hasClass = (state: TickState, name: string) => state.classes.split(" ").includes(name);

export function findTickState(states: TickState[], label: string): TickState {
  for (const state of states) {
    // if (state.text.startsWith(label))
    if (state.fullTime.startsWith(label))
      return state;
  }
  throw new Error(`no ruler tick has a full time starting with ${label}`);
}

function isCutPainted(state: TickState): boolean {
  for (const name of state.classes.split(" ")) {
    const isCutClass = name.startsWith("cut-");
    if (isCutClass)
      return true;
  }
  return false;
}

function countTicksWithClass(states: TickState[], name: string): number {
  let count = 0;
  for (const state of states) {
    const hasName = hasClass(state, name);
    if (hasName)
      count++;
  }
  return count;
}

// export function isUnarmedPaintRight(states: TickState[]): boolean {
//   let setCount = 0;
//   let baseCount = 0;
//   for (const state of states) {
//     if (hasClass(state, CutClass.ok) || hasClass(state, CutClass.no))
//       return false;
//     setCount += hasClass(state, CutClass.set) ? 1 : 0;
//     baseCount += hasClass(state, CutClass.base) ? 1 : 0;
//   }
//   return setCount === 2 && baseCount === 1;
// }

// Commit mode off: no tick carries a cut-* class and the page has no #jfred-strip.
export function isUnarmedPaintRight(states: TickState[], stripCount: number): boolean {
  let isClean = stripCount === 0;
  for (const state of states)
    isClean &&= !isCutPainted(state);
  return isClean;
}

function isScissorsTick(state: TickState): boolean {
  return hasClass(state, CutClass.ok) && state.after !== "none" && state.after !== "normal";
}

// function isDimTickWithReason(state: TickState, refusal: CutRefusal): boolean {
//   return hasClass(state, CutClass.no) && state.opacity < 1 && state.title === CUT_REFUSAL_TEXT[refusal];
// }
// On the test page a refused tick's title is the refusal text, a newline, then the full time.
function isDimTickWithReason(state: TickState, refusal: CutRefusal): boolean {
  return hasClass(state, CutClass.no) && state.opacity < 1 && state.title === `${CUT_REFUSAL_TEXT[refusal]}\n${state.fullTime}`;
}

// Armed: the base tick and the two commit ticks carry cut-base and cut-set.
function isMarkPaintRight(states: TickState[]): boolean {
  return countTicksWithClass(states, CutClass.base) === 1 && countTicksWithClass(states, CutClass.set) === 2;
}

export function isArmedPaintRight(isCurrent: boolean, states: TickState[]): boolean {
  let isRight = isCurrent && isMarkPaintRight(states) && isScissorsTick(findTickState(states, TICK_LABELS.late)) && isScissorsTick(findTickState(states, TICK_LABELS.early));
  for (const [label, refusal] of REFUSAL_CASES)
    isRight &&= isDimTickWithReason(findTickState(states, label), refusal);
  for (const state of states)
    isRight &&= !hasClass(state, CutClass.no) || state.title !== "";
  return isRight;
}

export function isRefusalShown(facts: RefusalFacts, refusal: CutRefusal): boolean {
  const isNoMark = facts.entries === 0 && facts.ticks === 0 && facts.tickFiles === 0;
  return facts.isShown && facts.text === CUT_REFUSAL_TEXT[refusal] && isNoMark;
}

export function isFirstMarkRight(facts: MarkFacts): boolean {
  const isPending = facts.pending.entries === 1 && facts.pending.ticks === 1 && facts.entries.at(-1)?.kind === JfredEntryKind.pending;
  return isPending && facts.drawer.isOpen && facts.drawer.hasButton && !facts.drawer.text.includes("unmarked");
}

export function isMovedMarkRight(facts: MarkFacts, independentCount: number): boolean {
  const isOnePending = facts.pending.entries === 1 && facts.pending.ticks === 1 && facts.entries.length === 4;
  return isOnePending && facts.drawer.hasButton && facts.drawer.text.includes(`includes ${independentCount} unmarked changes`);
}

export function isCommitRight(before: MarkFacts, after: MarkFacts): boolean {
  const added = after.entries.at(-1);
  const isAdded = after.entries.length === 4 && added?.kind === JfredEntryKind.commit && added.parentHash === after.entries[2]?.shortHash;
  return isAdded && after.chains === 3 && after.requests === before.requests + 1;
}

export function isMessageKept(before: MarkFacts, after: MarkFacts): boolean {
  const isLeftClean = after.pending.entries === 0 && after.pending.ticks === 0 && !after.drawer.hasButton && after.drawer.isOpen;
  return isLeftClean && after.drawer.text === before.drawer.text && after.drawer.text.split("\n").at(-1)!.startsWith(FOOTNOTE_PREFIX);
}

// A click on a two-event tick opens its file list; a second click closes it.
export async function validateNormalClick(page: HeadlessPage, title: string): Promise<void> {
  await page.evaluate(buildClickTick(TICK_LABELS.behindTip));
  const opened = await page.evaluate<number>(TICKFILES_COUNT);
  await page.evaluate(buildClickTick(TICK_LABELS.behindTip));
  const closed = await page.evaluate<number>(TICKFILES_COUNT);
  reportCheck(title, opened > 0 && closed === 0, [opened, closed]);
}

export async function validateUnarmedPaint(page: HeadlessPage): Promise<void> {
  const states = await page.evaluate<TickState[]>(TICK_STATES);
  const stripCount = await page.evaluate<number>(STRIP_COUNT);
  // reportCheck("L9 Commit mode off: no tick is scissors or dim; the base tick and two commit ticks keep their marks", isUnarmedPaintRight(states));
  reportCheck("L9 Commit mode off: no tick carries a cut-* class and there is no #jfred-strip", isUnarmedPaintRight(states, stripCount), [stripCount]);
}

export async function validateArmedPaint(page: HeadlessPage): Promise<void> {
  await page.evaluate(COMMIT_MODE_CLICK);
  const mode = await page.evaluate<{ isCurrent: boolean }>(MODE_STATE);
  const states = await page.evaluate<TickState[]>(TICK_STATES);
  // reportCheck("L9 Commit mode on: markable ticks show scissors, the others are dim with their refusal text as title", isArmedPaintRight(mode.isCurrent, states));
  reportCheck("L9 Commit mode on: base and commit ticks carry cut-base and cut-set, markable ticks show scissors, the others are dim with refusal text then full time as title", isArmedPaintRight(mode.isCurrent, states));
}

export async function validateRefusals(page: HeadlessPage): Promise<void> {
  for (const [label, refusal] of REFUSAL_CASES) {
    const facts = await page.evaluate<RefusalFacts>(buildRefusalClick(label));
    reportCheck(`L9 a click on ${label} shows the ${refusal} toast and leaves no pending mark and no open list`, isRefusalShown(facts, refusal), facts);
  }
}

export function isUnchangedQuestionRight(before: MarkFacts, after: MarkFacts, row: YesNoRowFacts): boolean {
  const isAsked = row.rows === 1 && row.text.includes(UNCHANGED_NEXT_INSTANT_PREFIX);
  const isKept = after.pending.entries === 1 && after.entries.length === before.entries.length;
  return isAsked && isKept && after.requests === before.requests + 1;
}

// The early tick is the canned unchanged range: Commit asks, No keeps the mark, Yes moves it.
export async function validateUnchangedRange(page: HeadlessPage): Promise<void> {
  await validateUnchangedQuestion(page);
  await validateUnchangedNo(page);
  await validateUnchangedYes(page);
}

async function validateUnchangedQuestion(page: HeadlessPage): Promise<void> {
  await page.evaluate(buildClickTick(TICK_LABELS.early));
  const before = await page.evaluate<MarkFacts>(MARK_FACTS);
  await page.evaluate(COMMIT_CLICK);
  const after = await page.evaluate<MarkFacts>(MARK_FACTS);
  const row = await page.evaluate<YesNoRowFacts>(YESNO_ROW_FACTS);
  reportCheck("L9 Commit on an unchanged range asks to move the mark to 06-03 18:20 and keeps the pending entry", isUnchangedQuestionRight(before, after, row), [before.requests, after.requests, row]);
}

async function validateUnchangedNo(page: HeadlessPage): Promise<void> {
  await page.evaluate(YESNO_NO);
  const kept = await page.evaluate<TickState[]>(TICK_STATES);
  const rowAfterNo = await page.evaluate<YesNoRowFacts>(YESNO_ROW_FACTS);
  const isKeptOnEarly = rowAfterNo.rows === 0 && hasClass(findTickState(kept, TICK_LABELS.early), CutClass.pending);
  reportCheck("L9 No on the unchanged-range question closes the row and the mark stays on 06-03 11:00", isKeptOnEarly, rowAfterNo);
}

async function validateUnchangedYes(page: HeadlessPage): Promise<void> {
  await page.evaluate(COMMIT_CLICK);
  await page.evaluate(YESNO_YES);
  const moved = await page.evaluate<MarkFacts>(MARK_FACTS);
  const movedStates = await page.evaluate<TickState[]>(TICK_STATES);
  const isOnLate = hasClass(findTickState(movedStates, TICK_LABELS.late), CutClass.pending) && !hasClass(findTickState(movedStates, TICK_LABELS.early), CutClass.pending);
  reportCheck("L9 Yes on the unchanged-range question moves the mark to 06-03 18:20 and the Commit button shows again", isOnLate && moved.pending.entries === 1 && moved.drawer.hasButton, moved);
}

export async function validatePendingMark(page: HeadlessPage): Promise<void> {
  const requestsBefore = await page.evaluate<number>(REQUEST_COUNT);
  await page.evaluate(buildClickTick(TICK_LABELS.early));
  const first = await page.evaluate<MarkFacts>(MARK_FACTS);
  reportCheck("L9 a mark on 06-03 11:00 gives one pending entry, a Commit button and a message without an unmarked line", isFirstMarkRight(first), first);
  await page.evaluate(buildClickTick(TICK_LABELS.late));
  const moved = await page.evaluate<MarkFacts>(MARK_FACTS);
  const independent = await page.evaluate<number>(buildBeaconInstantCount(moved.entries[2]!.instant, moved.entries[3]!.instant));
  reportCheck("L9 moving the mark to 06-03 18:20 keeps one pending entry and the message says includes N unmarked changes, N equal to the beacon instants between the tip and the mark", isMovedMarkRight(moved, independent), [independent, moved]);
  reportCheck("L9 placing and moving a mark sends no request", first.requests === requestsBefore && moved.requests === requestsBefore, [requestsBefore, first.requests, moved.requests]);
}

export async function validateCommit(page: HeadlessPage): Promise<void> {
  const before = await page.evaluate<MarkFacts>(MARK_FACTS);
  await page.evaluate(COMMIT_CLICK);
  const after = await page.evaluate<MarkFacts>(MARK_FACTS);
  reportCheck("L9 Commit adds one entry whose parent is the last commit, joined by a chain, with one commit request", isCommitRight(before, after), after);
  reportCheck("L9 after Commit no mark is pending, the button is gone, and the message is unchanged and ends with the footnote", isMessageKept(before, after), after.drawer);
}

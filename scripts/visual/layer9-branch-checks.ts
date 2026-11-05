// Layer 9 branch checks: a re-render keeps fake commits and Delete, and a new base starts a new branch.

import { type HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { isRefusalShown } from "./layer9-flow-checks.ts";
import {
  COMMIT_MODE_CLICK, CutClass, DELETE_CLICK, ENTRY_FACTS, FIXTURE_BASE_HASH, MARK_FACTS, MODE_STATE, STRIP_HEAD_FACTS, TICK_LABELS, TICK_STATES, TOGGLE_SETTLED,
  buildClickTick, buildRefusalClick, buildTimeToggle, type EntryFacts, type MarkFacts, type RefusalFacts, type StripHeadFacts, type TickState,
} from "./layer9-probes.ts";
import { CutRefusal } from "../../webapp/layer1-cut-rules.ts";
import { JfredEntryKind } from "../../webapp/layer1-jfred-entries.ts";

const WAIT_MS = 30_000;
const MARK_CLASSES: string[] = [CutClass.base, CutClass.set, CutClass.pending];

export function isBranchKept(entries: EntryFacts[]): boolean {
  const added = entries.at(-1);
  return entries.length === 4 && added?.kind === JfredEntryKind.commit && added.parentHash === entries[2]?.shortHash;
}

function hasAnyClass(state: TickState, names: string[]): boolean {
  for (const name of state.classes.split(" ")) {
    if (names.includes(name))
      return true;
  }
  return false;
}

export function isBranchGone(entries: EntryFacts[], states: TickState[]): boolean {
  let isGone = entries.length === 0;
  for (const state of states)
    isGone &&= !hasAnyClass(state, MARK_CLASSES);
  return isGone;
}

export function isModeOffClean(isCurrent: boolean, states: TickState[]): boolean {
  let isClean = !isCurrent;
  for (const state of states)
    isClean &&= !hasAnyClass(state, [CutClass.ok, CutClass.no]);
  return isClean;
}

// Commit mode stays on after Delete, so the strip keeps its head and its Delete button.
export function isStripHeadKept(facts: StripHeadFacts): boolean {
  return facts.stripCount === 1 && facts.headText.includes("commits") && facts.deleteCount === 1;
}

export function isBaseOnly(entries: EntryFacts[]): boolean {
  return entries.length === 1 && entries[0]!.kind === JfredEntryKind.base && entries[0]!.shortHash === FIXTURE_BASE_HASH;
}

export function isBaseKept(facts: MarkFacts): boolean {
  const [base, pending] = facts.entries;
  const isPair = facts.entries.length === 2 && base!.kind === JfredEntryKind.base && pending!.kind === JfredEntryKind.pending;
  return isPair && base!.shortHash === FIXTURE_BASE_HASH && pending!.parentHash === FIXTURE_BASE_HASH;
}

// Flips the time toggle there and back; each flip reloads the view only.
async function rerenderThroughTimeToggle(page: HeadlessPage): Promise<void> {
  for (const value of ["author", "committer"] as const) {
    await page.evaluate(buildTimeToggle(value));
    await page.waitFor(`${TOGGLE_SETTLED} && ${STRIP_IDLE}`, WAIT_MS);
  }
}

export async function validateCommitSurvivesRerender(page: HeadlessPage): Promise<void> {
  await rerenderThroughTimeToggle(page);
  const entries = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  reportCheck("L9 after a re-render through the time toggle the fake commit is still in the strip", isBranchKept(entries), entries);
}

async function validateDelete(page: HeadlessPage): Promise<void> {
  await page.evaluate(DELETE_CLICK);
  const entries = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  const states = await page.evaluate<TickState[]>(TICK_STATES);
  reportCheck("L9 Delete jfred branch leaves zero entries and no tick with a base, commit or pending mark", isBranchGone(entries, states), entries);
  await rerenderThroughTimeToggle(page);
  const afterRerender = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  reportCheck("L9 after a re-render through the time toggle the deleted branch stays deleted", afterRerender.length === 0, afterRerender);
  const head = await page.evaluate<StripHeadFacts>(STRIP_HEAD_FACTS);
  reportCheck("L9 after Delete and a stage re-render the strip still shows its commits head and the Delete button", isStripHeadKept(head), head);
}

async function validateNewBase(page: HeadlessPage): Promise<void> {
  const refused = await page.evaluate<RefusalFacts>(buildRefusalClick(TICK_LABELS.baseNeedsCommit));
  reportCheck("L9 with no base, a click on a snapshot-only tick shows the baseNeedsCommit toast", isRefusalShown(refused, CutRefusal.baseNeedsCommit), refused);
  const accepted = await page.evaluate<RefusalFacts>(buildRefusalClick(TICK_LABELS.base));
  const entries = await page.evaluate<EntryFacts[]>(ENTRY_FACTS);
  reportCheck("L9 a click on the commit tick shows no toast and starts one base entry", !accepted.isShown && isBaseOnly(entries), [accepted, entries]);
  await page.evaluate(buildClickTick(TICK_LABELS.afterBase));
  const marked = await page.evaluate<MarkFacts>(MARK_FACTS);
  reportCheck("L9 the next mark is pending and the base did not move", isBaseKept(marked), marked.entries);
}

export async function validateDeleteAndRebase(page: HeadlessPage): Promise<void> {
  await validateDelete(page);
  await validateNewBase(page);
  await page.evaluate(COMMIT_MODE_CLICK);
  const mode = await page.evaluate<{ isCurrent: boolean }>(MODE_STATE);
  const states = await page.evaluate<TickState[]>(TICK_STATES);
  reportCheck("L9 Commit mode off again: the button is not current and no tick is scissors or dim", isModeOffClean(mode.isCurrent, states), mode);
}

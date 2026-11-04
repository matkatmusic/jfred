// Tests for layer9-branch-checks.ts: re-render survival, Delete and the new base, with a fake page.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    isBaseKept, isBaseOnly, isBranchGone, isBranchKept, isModeOffClean, validateCommitSurvivesRerender, validateDeleteAndRebase,
} from "../scripts/visual/layer9-branch-checks.ts";
import { ENTRY_FACTS, MARK_FACTS, MODE_STATE, TICK_LABELS, TICK_STATES, buildRefusalClick, type EntryFacts, type MarkFacts, type RefusalFacts, type TickState } from "../scripts/visual/layer9-probes.ts";
import { CUT_REFUSAL_TEXT, CutRefusal } from "../webapp/layer1-cut-rules.ts";
import { makeScriptedPage, runCheck, type Answers } from "./layer9-fake-page.ts";

const makeEntry = (kind: string, shortHash: string | null, parentHash: string | null): EntryFacts => ({ kind, shortHash, parentHash, instant: "2026-06-01T09:00:00.000Z", cx: 0, cy: 0, tickCy: 0 });
const BASE = makeEntry("base", "a1b2c3d4", null);
const KEPT = [BASE, makeEntry("commit", "c0ffee01", "a1b2c3d4"), makeEntry("commit", "c0ffee02", "c0ffee01"), makeEntry("commit", "c0ffee03", "c0ffee02")];
const makeState = (classes: string): TickState => ({ text: "x (1)", classes, title: "", opacity: 1, after: "none" });
const CLEAN = [makeState("tick"), makeState("tick multi")];
const shown = (refusal: CutRefusal): RefusalFacts => ({ text: CUT_REFUSAL_TEXT[refusal], isShown: true, tickFiles: 0, entries: 0, ticks: 0 });
const NO_TOAST: RefusalFacts = { text: "", isShown: false, tickFiles: 0, entries: 0, ticks: 0 };
const PENDING: MarkFacts = {
    drawer: { isOpen: true, text: "", hasButton: true }, pending: { entries: 1, ticks: 1 }, chains: 1, requests: 0,
    entries: [BASE, makeEntry("pending", null, "a1b2c3d4")],
};

const failuresOf = async (check: () => Promise<void>) => (await runCheck(check)).newFailures;

test("validateCommitSurvivesRerender needs the commit added by the user to be in the strip after the re-render", async () => {
    const run = (entries: EntryFacts[]) => failuresOf(() => validateCommitSurvivesRerender(makeScriptedPage(new Map([[ENTRY_FACTS, [entries]]]))));
    assert.deepEqual(await run(KEPT), []);
    assert.equal((await run(KEPT.slice(0, 3))).length, 1);
    assert.equal((await run([])).length, 1);
});

interface Setup { afterDelete: EntryFacts[]; afterRerender: EntryFacts[]; states: TickState[]; refused: RefusalFacts; accepted: RefusalFacts; afterBase: EntryFacts[]; marked: MarkFacts; isCurrent: boolean }
const GOOD: Setup = {
    afterDelete: [], afterRerender: [], states: CLEAN, refused: shown(CutRefusal.baseNeedsCommit), accepted: NO_TOAST, afterBase: [BASE], marked: PENDING, isCurrent: false,
};
const runDelete = (change: Partial<Setup> = {}) => {
    const setup = { ...GOOD, ...change };
    const answers: Answers = new Map<string, unknown[]>([
        [ENTRY_FACTS, [setup.afterDelete, setup.afterRerender, setup.afterBase]], [TICK_STATES, [setup.states]],
        [buildRefusalClick(TICK_LABELS.baseNeedsCommit), [setup.refused]], [buildRefusalClick(TICK_LABELS.base), [setup.accepted]],
        [MARK_FACTS, [setup.marked]], [MODE_STATE, [{ isCurrent: setup.isCurrent }]],
    ]);
    return failuresOf(() => validateDeleteAndRebase(makeScriptedPage(answers)));
};

test("validateDeleteAndRebase passes the good flow: 6 checks and no failure", async () => {
    assert.deepEqual(await runDelete(), []);
});

test("a Delete that keeps entries or tick marks, or a re-render that brings them back, fails one check each", async () => {
    assert.equal((await runDelete({ afterDelete: KEPT })).length, 1);
    assert.equal((await runDelete({ states: [makeState("tick cut-set")] })).length, 1);
    assert.equal((await runDelete({ afterRerender: KEPT })).length, 1);
});

test("a wrong refusal, a toast on the base click or a moved base fails one check each", async () => {
    assert.equal((await runDelete({ refused: shown(CutRefusal.notForward) })).length, 1);
    assert.equal((await runDelete({ accepted: shown(CutRefusal.noVerifiedNode) })).length, 1);
    assert.equal((await runDelete({ afterBase: [makeEntry("base", "e4f5a6b7", null)] })).length, 1);
    const moved = { ...PENDING, entries: [BASE, makeEntry("pending", null, "c0ffee02")] };
    assert.equal((await runDelete({ marked: moved })).length, 1);
});

test("a mode button that stays current fails the mode-off check", async () => {
    assert.equal((await runDelete({ isCurrent: true })).length, 1);
    assert.equal(isModeOffClean(false, [makeState("tick cut-ok")]), false);
});

test("the pure judges agree with the checks", () => {
    assert.equal(isBranchKept(KEPT), true);
    assert.equal(isBranchKept([...KEPT.slice(0, 3), makeEntry("commit", "c0ffee03", "a1b2c3d4")]), false);
    assert.equal(isBranchGone([], [makeState("tick cut-pending")]), false);
    assert.equal(isBaseOnly([BASE]), true);
    assert.equal(isBaseOnly([BASE, BASE]), false);
    assert.equal(isBaseKept(PENDING), true);
});

// Tests for layer9-branch-checks.ts: re-render survival, Delete and the new base, with a fake page.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    isBaseKept, isBaseOnly, isBranchGone, isBranchKept, isDeleteQuestionClosed, isDeleteQuestionOpen, isModeOffClean, isStripHeadKept, validateCommitSurvivesRerender, validateDeleteAndRebase,
} from "../scripts/visual/layer9-branch-checks.ts";
import {
    DELETE_OPEN, ENTRY_FACTS, MARK_FACTS, MODE_STATE, STRIP_HEAD_FACTS, TICK_LABELS, TICK_STATES, YESNO_NO, buildRefusalClick,
    type EntryFacts, type MarkFacts, type RefusalFacts, type StripHeadFacts, type TickState,
} from "../scripts/visual/layer9-probes.ts";
import { REQUEST_COUNT } from "../scripts/visual/layer7-probes.ts";
import { CUT_REFUSAL_TEXT, CutRefusal } from "../webapp/layer1-components/commits-column/layer1-cut-rules.ts";
import { makeScriptedPage, runCheck, type Answers } from "./layer9-fake-page.ts";

const makeEntry = (kind: string, shortHash: string | null, parentHash: string | null): EntryFacts => ({ kind, shortHash, parentHash, instant: "2026-06-01T09:00:00.000Z", cx: 0, cy: 0, tickCy: 0 });
const BASE = makeEntry("base", "a1b2c3d4", null);
const KEPT = [BASE, makeEntry("commit", "c0ffee01", "a1b2c3d4"), makeEntry("commit", "c0ffee02", "c0ffee01"), makeEntry("commit", "c0ffee03", "c0ffee02")];
// const makeState = (classes: string): TickState => ({ text: "x (1)", classes, title: "", opacity: 1, after: "none" });
const makeState = (classes: string): TickState => ({ text: "x (1)", fullTime: "06-01 09:00:00.000", classes, title: "", opacity: 1, after: "none" });
const KEPT_HEAD: StripHeadFacts = { stripCount: 1, headText: "commits", deleteCount: 1 };
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

interface Setup {
    afterDelete: EntryFacts[]; afterRerender: EntryFacts[]; head: StripHeadFacts; states: TickState[]; refused: RefusalFacts; accepted: RefusalFacts;
    afterBase: EntryFacts[]; marked: MarkFacts; isCurrent: boolean;
    openRowCount: number; closedRowCount: number; requestsAfterOpen: number; entriesWhileAsking: EntryFacts[];
}
const GOOD: Setup = {
    afterDelete: [], afterRerender: [], head: KEPT_HEAD, states: CLEAN, refused: shown(CutRefusal.baseNeedsCommit), accepted: NO_TOAST, afterBase: [BASE], marked: PENDING, isCurrent: false,
    openRowCount: 1, closedRowCount: 0, requestsAfterOpen: 5, entriesWhileAsking: KEPT,
};
const YESNO_ROW_COUNT = `document.querySelectorAll('#yesno-row').length`;
const runDelete = (change: Partial<Setup> = {}) => {
    const setup = { ...GOOD, ...change };
    const answers: Answers = new Map<string, unknown[]>([
        [ENTRY_FACTS, [KEPT, setup.entriesWhileAsking, KEPT, setup.afterDelete, setup.afterRerender, setup.afterBase]], [TICK_STATES, [setup.states]],
        [YESNO_ROW_COUNT, [setup.openRowCount, setup.closedRowCount]], [REQUEST_COUNT, [5, setup.requestsAfterOpen]],
        [DELETE_OPEN, []], [YESNO_NO, []],
        [buildRefusalClick(TICK_LABELS.baseNeedsCommit), [setup.refused]], [buildRefusalClick(TICK_LABELS.base), [setup.accepted]],
        [MARK_FACTS, [setup.marked]], [MODE_STATE, [{ isCurrent: setup.isCurrent }]], [STRIP_HEAD_FACTS, [setup.head]],
    ]);
    return failuresOf(() => validateDeleteAndRebase(makeScriptedPage(answers)));
};

test("validateDeleteAndRebase passes the good flow: 9 checks and no failure", async () => {
    assert.deepEqual(await runDelete(), []);
});

test("test_delete_that_sends_a_request_or_keeps_the_row_open_fails_one_check_each", async () => {
    // A request sent while the question is open fails the asks-first check.
    assert.equal((await runDelete({ requestsAfterOpen: 6 })).length, 1);
    // No row after Delete fails the asks-first check.
    assert.equal((await runDelete({ openRowCount: 0 })).length, 1);
    // A row that stays after No fails the closes-on-No check.
    assert.equal((await runDelete({ closedRowCount: 1 })).length, 1);
});

test("test_strip_head_and_delete_button_stay_after_delete_and_a_stage_redraw", async () => {
    // Setup: strip, commits head and one Delete button remain after the re-render.
    assert.deepEqual(await runDelete(), []);
    // A missing strip fails exactly one check.
    assert.equal((await runDelete({ head: { ...KEPT_HEAD, stripCount: 0 } })).length, 1);
    // A missing Delete button fails exactly one check.
    assert.equal((await runDelete({ head: { ...KEPT_HEAD, deleteCount: 0 } })).length, 1);
    // A head without the word commits fails exactly one check.
    assert.equal((await runDelete({ head: { ...KEPT_HEAD, headText: "" } })).length, 1);
    // The judge agrees.
    assert.equal(isStripHeadKept(KEPT_HEAD), true);
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

test("test_delete_question_open_needs_one_row_unchanged_entries_and_no_request", () => {
    // The good case passes: one row, same entries, same request count.
    assert.equal(isDeleteQuestionOpen(1, KEPT, KEPT, 5, 5), true);
    // No row fails.
    assert.equal(isDeleteQuestionOpen(0, KEPT, KEPT, 5, 5), false);
    // A changed entry list fails.
    assert.equal(isDeleteQuestionOpen(1, KEPT, KEPT.slice(0, 3), 5, 5), false);
    // A new request fails.
    assert.equal(isDeleteQuestionOpen(1, KEPT, KEPT, 5, 6), false);
});

test("test_delete_question_closed_needs_no_row_and_unchanged_entries", () => {
    // The good case passes: no row, same entries.
    assert.equal(isDeleteQuestionClosed(0, KEPT, KEPT), true);
    // A row that stays fails.
    assert.equal(isDeleteQuestionClosed(1, KEPT, KEPT), false);
    // A changed entry list fails.
    assert.equal(isDeleteQuestionClosed(0, KEPT, KEPT.slice(0, 3)), false);
});

test("the pure judges agree with the checks", () => {
    assert.equal(isBranchKept(KEPT), true);
    assert.equal(isBranchKept([...KEPT.slice(0, 3), makeEntry("commit", "c0ffee03", "a1b2c3d4")]), false);
    assert.equal(isBranchGone([], [makeState("tick cut-pending")]), false);
    assert.equal(isBaseOnly([BASE]), true);
    assert.equal(isBaseOnly([BASE, BASE]), false);
    assert.equal(isBaseKept(PENDING), true);
});

// Tests for layer9-flow-checks.ts: each judge and check, with a fake page of canned facts.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    findTickState, isArmedPaintRight, isCommitRight, isFirstMarkRight, isMessageKept, isMovedMarkRight, isRefusalShown, isUnarmedPaintRight, isUnchangedQuestionRight,
    validateArmedPaint, validateCommit, validateNormalClick, validatePendingMark, validateRefusals, validateUnarmedPaint,
} from "../scripts/visual/layer9-flow-checks.ts";
import { REQUEST_COUNT } from "../scripts/visual/layer7-probes.ts";
import {
    COMMIT_MODE_CLICK, MARK_FACTS, MODE_STATE, STRIP_COUNT, TICKFILES_COUNT, TICK_LABELS, TICK_STATES, buildBeaconInstantCount, buildFindTick, buildRefusalClick,
    type EntryFacts, type MarkFacts, type RefusalFacts, type TickState,
} from "../scripts/visual/layer9-probes.ts";
import { CUT_REFUSAL_TEXT, CutRefusal } from "../webapp/layer1-components/commits-column/layer1-cut-rules.ts";
import { makeScriptedPage, runCheck, type Answers } from "./layer9-fake-page.ts";

// The visible text is the short ruler time; only fullTime starts with the label.
// const makeState = (label: string, classes = "tick", extra: Partial<TickState> = {}): TickState => ({ text: `${label} (1)`, classes, title: "", opacity: 1, after: "none", ...extra });
const makeState = (label: string, classes = "tick", extra: Partial<TickState> = {}): TickState => ({ text: "01-01-2026:00:00 (1)", fullTime: label, classes, title: "", opacity: 1, after: "none", ...extra });
const REASON: Record<string, CutRefusal> = {
    [TICK_LABELS.createdOnly]: CutRefusal.noVerifiedNode, [TICK_LABELS.derivedOnly]: CutRefusal.noVerifiedNode,
    [TICK_LABELS.behindTip]: CutRefusal.notForward, [TICK_LABELS.atTip]: CutRefusal.notForward,
};
// On the test page a refused tick's title is the refusal text, a newline, then the full time.
const makeDim = (label: string, refusal: CutRefusal) => makeState(label, "tick cut-no", { opacity: 0.38, title: `${CUT_REFUSAL_TEXT[refusal]}\n${label}` });
const makeScissors = (label: string) => makeState(label, "tick cut-ok", { after: '"✂"' });
// Commit mode off: no tick carries any cut-* class.
// const UNARMED: TickState[] = [makeState(TICK_LABELS.base, "tick multi cut-base"), makeState(TICK_LABELS.afterBase, "tick cut-set"), makeState(TICK_LABELS.atTip, "tick cut-set"), makeState("07-01 00:00:00.000")];
const UNARMED: TickState[] = [makeState(TICK_LABELS.base, "tick multi"), makeState(TICK_LABELS.afterBase), makeState(TICK_LABELS.atTip), makeState("07-01 00:00:00.000")];
const ARMED_MARKS: TickState[] = [
    makeState(TICK_LABELS.base, "tick cut-base cut-ok", { after: '"✂"' }), makeState(TICK_LABELS.afterBase, "tick cut-set cut-ok", { after: '"✂"' }),
    makeState("07-02 00:00:00.000", "tick cut-set cut-no", { opacity: 0.38, title: "reason\n07-02 00:00:00.000" }),
];
const ARMED: TickState[] = [
    makeScissors(TICK_LABELS.late), makeScissors(TICK_LABELS.early), makeDim(TICK_LABELS.createdOnly, CutRefusal.noVerifiedNode), makeDim(TICK_LABELS.derivedOnly, CutRefusal.noVerifiedNode),
    makeDim(TICK_LABELS.behindTip, CutRefusal.notForward), makeDim(TICK_LABELS.atTip, CutRefusal.notForward), ...ARMED_MARKS,
];

const ENTRY_INSTANT = "2026-06-03T18:20:00.000Z";
const makeEntry = (kind: string, shortHash: string | null, parentHash: string | null): EntryFacts => ({ kind, shortHash, parentHash, instant: ENTRY_INSTANT, cx: 0, cy: 0, tickCy: 0 });
const BASE_ENTRIES = [makeEntry("base", "a1b2c3d4", null), makeEntry("commit", "c0ffee01", "a1b2c3d4"), makeEntry("commit", "c0ffee02", "c0ffee01")];
const MESSAGE = "jfred: reconstruct to X\n\nincludes 1 unmarked changes\n\nAuthor-Date: X\nCommit-Date: Y\nreconstructed by JFRED @ Y";
const PENDING_FACTS: MarkFacts = {
    drawer: { isOpen: true, text: MESSAGE, hasButton: true }, pending: { entries: 1, ticks: 1 }, chains: 3, requests: 100,
    entries: [...BASE_ENTRIES, makeEntry("pending", null, "c0ffee02")],
};
const COMMITTED_FACTS: MarkFacts = {
    drawer: { isOpen: true, text: MESSAGE, hasButton: false }, pending: { entries: 0, ticks: 0 }, chains: 3, requests: 101,
    entries: [...BASE_ENTRIES, makeEntry("commit", "c0ffee03", "c0ffee02")],
};
const MOVED_FACTS: MarkFacts = PENDING_FACTS;
const FIRST_FACTS: MarkFacts = { ...PENDING_FACTS, drawer: { ...PENDING_FACTS.drawer, text: "jfred: reconstruct to X\n\nAuthor-Date: X" } };
const GOOD_REFUSAL = (refusal: CutRefusal): RefusalFacts => ({ text: CUT_REFUSAL_TEXT[refusal], isShown: true, tickFiles: 0, entries: 0, ticks: 0 });

const failuresOf = async (check: () => Promise<void>) => (await runCheck(check)).newFailures;

test("validateNormalClick passes when the list opens and then closes, and fails otherwise", async () => {
    const run = (counts: number[]) => failuresOf(() => validateNormalClick(makeScriptedPage(new Map([[TICKFILES_COUNT, counts]])), "L9 normal"));
    assert.deepEqual(await run([1, 0]), []);
    assert.deepEqual(await run([0, 0]), ["L9 normal"]);
    assert.deepEqual(await run([1, 1]), ["L9 normal"]);
});

// test("validateUnarmedPaint needs one base tick, two set ticks and no scissors or dim tick", async () => {
//     const run = (states: TickState[]) => failuresOf(() => validateUnarmedPaint(makeScriptedPage(new Map([[TICK_STATES, [states]]]))));
//     assert.deepEqual(await run(UNARMED), []);
//     assert.equal((await run([...UNARMED, makeScissors("07-02 00:00:00.000")])).length, 1);
//     assert.equal((await run([UNARMED[0]!, UNARMED[1]!, UNARMED[3]!])).length, 1);
//     assert.equal(isUnarmedPaintRight([...UNARMED, makeDim("07-02 00:00:00.000", CutRefusal.notForward)]), false);
// });

const runUnarmed = (states: TickState[], stripCount: number) =>
    failuresOf(() => validateUnarmedPaint(makeScriptedPage(new Map<string, unknown[]>([[TICK_STATES, [states]], [STRIP_COUNT, [stripCount]]]))));

test("test_commit_mode_off_means_no_cut_class_on_any_tick_and_no_strip", async () => {
    // Setup: ticks with no cut-* class and a page with no #jfred-strip.  The check passes.
    assert.deepEqual(await runUnarmed(UNARMED, 0), []);
    // A strip on the page fails the check.
    assert.equal((await runUnarmed(UNARMED, 1)).length, 1);
    // A cut-base, cut-set, cut-pending, cut-ok or cut-no class on any one tick fails the check.
    for (const name of ["cut-base", "cut-set", "cut-pending", "cut-ok", "cut-no"])
        assert.equal((await runUnarmed([...UNARMED, makeState("07-02 00:00:00.000", `tick ${name}`)], 0)).length, 1, name);
    // The judge agrees.
    assert.equal(isUnarmedPaintRight(UNARMED, 0), true);
    assert.equal(isUnarmedPaintRight([...UNARMED, makeDim("07-02 00:00:00.000", CutRefusal.notForward)], 0), false);
});

test("test_every_tick_lookup_reads_the_full_time_first_and_the_text_only_without_it", () => {
    // // The finder passes the label to startsWith on dataset.fullTime and never reads textContent.
    // assert.ok(buildFindTick("06-03 18:20:00.000").includes("t.dataset.fullTime.startsWith"));
    // assert.ok(!buildFindTick("06-03 18:20:00.000").includes("textContent"));
    // The finder reads dataset.fullTime first and falls back to textContent.
    assert.ok(buildFindTick("06-03 18:20:00.000").includes("t.dataset.fullTime ?? t.textContent"));
    // A state whose text does not start with the label is still found by its full time.
    assert.equal(findTickState(UNARMED, TICK_LABELS.base).fullTime, TICK_LABELS.base);
});

const runArmed = (isCurrent: boolean, states: TickState[]) =>
    failuresOf(() => validateArmedPaint(makeScriptedPage(new Map<string, unknown[]>([[COMMIT_MODE_CLICK, []], [MODE_STATE, [{ isCurrent }]], [TICK_STATES, [states]]]))));

test("validateArmedPaint passes the good paint and fails each single bad fact", async () => {
    assert.deepEqual(await runArmed(true, ARMED), []);
    assert.equal((await runArmed(false, ARMED)).length, 1);
    assert.equal((await runArmed(true, [makeState(TICK_LABELS.late, "tick cut-ok"), ...ARMED.slice(1)])).length, 1);
    assert.equal((await runArmed(true, [...ARMED.slice(0, 3), makeDim(TICK_LABELS.derivedOnly, CutRefusal.notForward), ...ARMED.slice(4)])).length, 1);
    assert.equal((await runArmed(true, [...ARMED, makeState("07-05 00:00:00.000", "tick cut-no", { opacity: 0.38 })])).length, 1);
    assert.equal(isArmedPaintRight(true, [...ARMED.slice(0, 5), makeState(TICK_LABELS.atTip, "tick cut-no", { opacity: 0.38, title: "" })]), false);
});

test("test_armed_paint_needs_cut_base_on_one_tick_and_cut_set_on_two_ticks", async () => {
    // The good armed paint carries one cut-base tick and two cut-set ticks: no failure.
    assert.deepEqual(await runArmed(true, ARMED), []);
    // Without the cut-base tick the check fails.
    assert.equal((await runArmed(true, ARMED.filter((state) => !state.classes.includes("cut-base")))).length, 1);
    // With only one cut-set tick the check fails.
    assert.equal((await runArmed(true, ARMED.filter((state) => state.fullTime !== "07-02 00:00:00.000"))).length, 1);
    // A refusal title without the full time after the newline fails the check.
    const bareTitle = makeState(TICK_LABELS.atTip, "tick cut-no", { opacity: 0.38, title: CUT_REFUSAL_TEXT[CutRefusal.notForward] });
    assert.equal(isArmedPaintRight(true, [...ARMED.filter((state) => state.fullTime !== TICK_LABELS.atTip), bareTitle]), false);
});

test("findTickState throws for a missing tick", () => {
    assert.throws(() => findTickState(UNARMED, "01-01 00:00:00.000"), /no ruler tick/);
});

const runRefusals = (answerFor: (label: string) => RefusalFacts) => {
    const answers: Answers = new Map();
    for (const label of Object.keys(REASON))
        answers.set(buildRefusalClick(label), [answerFor(label)]);
    return failuresOf(() => validateRefusals(makeScriptedPage(answers)));
};

test("validateRefusals checks the exact text per tick and that nothing else changed", async () => {
    const good = (label: string) => GOOD_REFUSAL(REASON[label]!);
    assert.deepEqual(await runRefusals(good), []);
    const wrongText = (label: string) => (label === TICK_LABELS.atTip ? GOOD_REFUSAL(CutRefusal.noVerifiedNode) : good(label));
    assert.equal((await runRefusals(wrongText)).length, 1);
    assert.equal((await runRefusals((label) => ({ ...good(label), isShown: false }))).length, 4);
    assert.equal((await runRefusals((label) => ({ ...good(label), entries: 1 }))).length, 4);
    assert.equal((await runRefusals((label) => ({ ...good(label), tickFiles: 1 }))).length, 4);
});

test("isRefusalShown needs the exact text, a shown toast and no pending mark, tick mark or list", () => {
    assert.equal(isRefusalShown(GOOD_REFUSAL(CutRefusal.baseNeedsCommit), CutRefusal.baseNeedsCommit), true);
    assert.equal(isRefusalShown(GOOD_REFUSAL(CutRefusal.baseNeedsCommit), CutRefusal.notForward), false);
    assert.equal(isRefusalShown({ ...GOOD_REFUSAL(CutRefusal.notForward), ticks: 1 }, CutRefusal.notForward), false);
});

const runPending = (first: MarkFacts, moved: MarkFacts, requestsBefore = 100) =>
    failuresOf(() => validatePendingMark(makeScriptedPage(new Map<string, unknown[]>([
        [REQUEST_COUNT, [requestsBefore]], [MARK_FACTS, [first, moved]], [buildBeaconInstantCount(ENTRY_INSTANT, ENTRY_INSTANT), [1]],
    ]))));

test("validatePendingMark passes the good marks and fails each single bad fact", async () => {
    assert.deepEqual(await runPending(FIRST_FACTS, MOVED_FACTS), []);
    assert.equal((await runPending({ ...FIRST_FACTS, drawer: { ...FIRST_FACTS.drawer, text: MESSAGE } }, MOVED_FACTS)).length, 1);
    assert.equal((await runPending({ ...FIRST_FACTS, drawer: { ...FIRST_FACTS.drawer, hasButton: false } }, MOVED_FACTS)).length, 1);
    assert.equal((await runPending({ ...FIRST_FACTS, pending: { entries: 2, ticks: 1 } }, MOVED_FACTS)).length, 1);
    assert.equal((await runPending(FIRST_FACTS, { ...MOVED_FACTS, drawer: { ...MOVED_FACTS.drawer, text: "no includes" } })).length, 1);
    assert.equal((await runPending(FIRST_FACTS, { ...MOVED_FACTS, pending: { entries: 1, ticks: 0 } })).length, 1);
    assert.equal((await runPending(FIRST_FACTS, { ...MOVED_FACTS, requests: 101 })).length, 1);
    assert.equal(isMovedMarkRight({ ...MOVED_FACTS, entries: BASE_ENTRIES }, 1), false);
    assert.equal(isMovedMarkRight(MOVED_FACTS, 2), false);
    assert.equal(isFirstMarkRight({ ...FIRST_FACTS, drawer: { ...FIRST_FACTS.drawer, isOpen: false } }), false);
});

const runCommit = (after: MarkFacts) =>
    failuresOf(() => validateCommit(makeScriptedPage(new Map<string, unknown[]>([[MARK_FACTS, [PENDING_FACTS, after]]]))));

test("validateCommit passes the good commit and fails each single bad fact", async () => {
    assert.deepEqual(await runCommit(COMMITTED_FACTS), []);
    const added = COMMITTED_FACTS.entries.slice(0, 3);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, entries: [...added, makeEntry("commit", "c0ffee03", "a1b2c3d4")] })).length, 1);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, entries: added })).length, 1);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, chains: 2 })).length, 1);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, requests: 100 })).length, 1);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, pending: { entries: 1, ticks: 0 } })).length, 1);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, drawer: { ...COMMITTED_FACTS.drawer, hasButton: true } })).length, 1);
    assert.equal((await runCommit({ ...COMMITTED_FACTS, drawer: { ...COMMITTED_FACTS.drawer, text: `${MESSAGE}\nx` } })).length, 1);
});

test("test_unchanged_question_needs_one_row_naming_the_next_instant_and_one_new_request", () => {
    // Setup: the pending facts before Commit; after Commit one row asks, the mark stays and one request goes out.
    const asked = { ...PENDING_FACTS, requests: 101 };
    const row = { rows: 1, text: "Move the mark to 2026-06-03T18:20:00?" };
    // The good case passes.
    assert.equal(isUnchangedQuestionRight(PENDING_FACTS, asked, row), true);
    // No question row fails.
    assert.equal(isUnchangedQuestionRight(PENDING_FACTS, asked, { ...row, rows: 0 }), false);
    // A row that names another instant fails.
    assert.equal(isUnchangedQuestionRight(PENDING_FACTS, asked, { ...row, text: "Move the mark?" }), false);
    // A lost pending entry fails.
    assert.equal(isUnchangedQuestionRight(PENDING_FACTS, { ...asked, pending: { entries: 0, ticks: 0 } }, row), false);
    // No new request fails.
    assert.equal(isUnchangedQuestionRight(PENDING_FACTS, PENDING_FACTS, row), false);
});

test("the pure commit judges agree with the checks", () => {
    assert.equal(isCommitRight(PENDING_FACTS, COMMITTED_FACTS), true);
    assert.equal(isMessageKept(PENDING_FACTS, COMMITTED_FACTS), true);
    assert.equal(isMessageKept(PENDING_FACTS, { ...COMMITTED_FACTS, drawer: { ...COMMITTED_FACTS.drawer, isOpen: false } }), false);
});

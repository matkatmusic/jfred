// Tests for scripts/visual/engine-v3-checks.ts: a fake page runs the real marker state, the checks judge its answers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    BUTTON_LABELS, COUNT_COMMIT_NODES, COUNT_SESSION_NODES, FETCH_RULER, FETCH_STEPS, READ_COMMIT_HASHES, READ_CURRENT_NODE_ID, READ_LINE_FACTS,
    READ_LINE_IN_VIEW, READ_MARKER_INDEX, READ_OFF_FLAGS, READ_SENTENCE, READ_TRACK_COUNT, buildClickButtonByLabel, buildClickLabelWhileOn, buildClickNode,
    buildReadLeaderTop, validateEngineV3Mockup,
} from "../scripts/visual/engine-v3-checks.ts";
import { CLICK_SESSION_TOGGLE } from "../scripts/visual/layer7-probes.ts";
import {
    containsCommitAfterMarker, isMarkerOnFirstStep, isMarkerOnLastStep, moveMarkerBackward, moveMarkerForward, moveMarkerToNextCommit,
    moveMarkerToNode, moveMarkerToPreviousCommit, readCurrentStep, readMarkerIndex, resetMarkerToStart, storeEngineV3Steps,
} from "../webapp/layer1-components/engine-v3/layer1-engine-v3-state.ts";
import { EngineV3StepKind, type WireEngineV3Step } from "../webapp/layer1-components/engine-v3/layer1-wire-engine-v3.ts";
import { runCheck } from "./layer9-fake-page.ts";
import type { HeadlessPage } from "../scripts/visual/cdp.ts";

const { commit, edit, script } = EngineV3StepKind;
const KINDS = [commit, edit, edit, commit, script, commit, edit, commit, edit];
const STEPS: WireEngineV3Step[] = KINDS.map((kind, index) => ({
    nodeId: `n${index}`, nodeTime: `2026-06-01T09:0${index}:00.000Z`, kind, filesChanged: [], sentence: `s${index}`,
}));
const BUTTON_ACTIONS: Record<string, () => void> = {
    "Start over": resetMarkerToStart, "Jump to previous commit": moveMarkerToPreviousCommit, "Step backwards": moveMarkerBackward,
    "Step forward": moveMarkerForward, "Jump to next commit": moveMarkerToNextCommit,
};
const AXIS_STEP_PX = 100;
const LANE_Y = 52;

// What the fake page gets wrong, one fault per test.
interface Faults { isRuleBroken?: boolean; isLineStuck?: boolean; isLineOffScreen?: boolean }

// The page's five off flags, in button order, as the panel sets them.
function readOffFlags(isRuleBroken: boolean): string {
    const flags = [isMarkerOnFirstStep(), isMarkerOnFirstStep(), isMarkerOnFirstStep(), isMarkerOnLastStep(), !containsCommitAfterMarker()];
    return flags.map((isOff) => (isOff && !isRuleBroken ? "1" : "0")).join("");
}

function readNodes(isCommit: boolean): string[] {
    const step = readCurrentStep()!;
    return (step.kind === commit) === isCommit ? [step.nodeId] : [];
}

function listMarkerAnswers(faults: Faults): [string, () => unknown][] {
    return [
        [FETCH_STEPS, () => ({ steps: STEPS })],
        [COUNT_SESSION_NODES, () => readNodes(false).length],
        [COUNT_COMMIT_NODES, () => readNodes(true).length * 2],
        [READ_COMMIT_HASHES, () => readNodes(true).join(",")],
        [READ_CURRENT_NODE_ID, () => readNodes(false).join(",")],
        [READ_MARKER_INDEX, () => String(readMarkerIndex())],
        [READ_SENTENCE, () => readCurrentStep()!.sentence],
        [READ_OFF_FLAGS, () => readOffFlags(faults.isRuleBroken === true)],
    ];
}

function listLineAnswers(faults: Faults, readSessionCount: () => number): [string, () => unknown][] {
    const lineIndex = () => (faults.isLineStuck ? 0 : readMarkerIndex());
    const answers: [string, () => unknown][] = [
        [FETCH_RULER, () => STEPS.map((step, index) => ({ instant: step.nodeTime, axisPx: index * AXIS_STEP_PX, eventCount: 1 }))],
        [READ_LINE_FACTS, () => ({ top: lineIndex() * AXIS_STEP_PX + LANE_Y, laneY: LANE_Y })],
        [READ_LINE_IN_VIEW, () => faults.isLineOffScreen !== true],
        [READ_TRACK_COUNT, readSessionCount],
    ];
    for (const index of STEPS.keys()) answers.push([buildReadLeaderTop(index * AXIS_STEP_PX), () => index * AXIS_STEP_PX + LANE_Y]);
    return answers;
}

function listFakeAnswers(faults: Faults): Map<string, () => unknown> {
    let isSessionOn = false;
    const answers = new Map<string, () => unknown>([...listMarkerAnswers(faults), ...listLineAnswers(faults, () => (isSessionOn ? 1 : 0))]);
    answers.set(CLICK_SESSION_TOGGLE, () => { isSessionOn = !isSessionOn; });
    for (const label of BUTTON_LABELS) {
        answers.set(buildClickButtonByLabel(label), BUTTON_ACTIONS[label]!);
        answers.set(buildClickLabelWhileOn(label), () => {
            while (readOffFlags(false)[BUTTON_LABELS.indexOf(label)] === "0") BUTTON_ACTIONS[label]!();
        });
    }
    for (const step of STEPS) answers.set(buildClickNode(step.nodeId), () => moveMarkerToNode(step.nodeId));
    return answers;
}

function makeMarkerPage(faults: Faults): HeadlessPage {
    storeEngineV3Steps(STEPS);
    const answers = listFakeAnswers(faults);
    return {
        evaluate: async <T>(expression: string) => answers.get(expression)?.() as T,
        waitFor: async () => {}, navigate: async () => {}, screenshot: async () => "", close: async () => {},
    };
}

async function listFailuresWith(faults: Faults): Promise<string[]> {
    const { newFailures } = await runCheck(() => validateEngineV3Mockup(makeMarkerPage(faults)));
    return newFailures;
}

test("test_the_checks_pass_when_the_marker_the_off_flags_and_the_line_follow_every_click", async () => {
    // Steps: run the checks on a page that applies the real marker rules, expect no failure.
    assert.deepEqual(await listFailuresWith({}), []);
});

test("test_the_checks_fail_when_no_button_is_ever_turned_off", async () => {
    const failures = await listFailuresWith({ isRuleBroken: true });
    assert.ok(failures.length > 0);
    assert.ok(failures.every((title) => title.includes("off")), failures.join(" | "));
});

test("test_the_checks_fail_when_the_line_does_not_follow_the_marker", async () => {
    // Steps: the line stays at step 0, expect only the y-match checks to fail.
    const failures = await listFailuresWith({ isLineStuck: true });
    assert.ok(failures.length > 0);
    assert.ok(failures.every((title) => title.includes("within 2px")), failures.join(" | "));
});

test("test_the_checks_fail_when_the_line_is_not_scrolled_into_view", async () => {
    const failures = await listFailuresWith({ isLineOffScreen: true });
    assert.ok(failures.length > 0);
    assert.ok(failures.every((title) => title.includes("visible")), failures.join(" | "));
});

test("test_the_checks_look_at_the_line_with_the_session_column_off", async () => {
    // Steps: run the checks, expect the line checks named with session off among the passes.
    const { lines } = await runCheck(() => validateEngineV3Mockup(makeMarkerPage({})));
    assert.ok(lines.some((line) => line.includes("session off") && line.includes("within 2px")), lines.join("\n"));
});

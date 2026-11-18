// The consent state of the terminal UI: which question to ask, and what a script stop does.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus, InverseStepOutcome, ScriptAction, StepProcessOutcomeKind } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import type { StepResultLine } from "../engineV3/engineV3_step_start_at.ts";
import { chooseFileForPlayKey, createConsentGate, decideScriptAction, getNextConsentQuestion, type ConsentAnswers, type StoppedWalk } from "../engineV3/tui/engineV3_tui_consent.ts";
import { createHistoryWalker } from "../engineV3/tui/engineV3_tui_walk.ts";
import { createWalkState, getFileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import type { StepProcessOutcome, StepRequest } from "../engineV3/tui/engineV3_tui_walk_types.ts";
import { PROJECT_FILE_NAME, makeInstant } from "./engineV3_step_test_projects.ts";

const MARKER_TIME = makeInstant(20);
const SOURCE_TEXT = "toolu_x";
const SCRIPT_FILE = new Path("/project/script_target.txt");

function makeAnswers(runScripts: boolean | undefined, runModifyingScriptsAutomatically: boolean | undefined): ConsentAnswers {
    return { runScripts, runModifyingScriptsAutomatically };
}

const GATE_WAIT_MILLISECONDS = 30;

async function readGateIsResolved(whenAnswered: Promise<void>): Promise<boolean> {
    const resolvedMarker = Symbol("resolved");
    const timeoutMarker = Symbol("timeout");
    const winner = await Promise.race([
        whenAnswered.then(() => resolvedMarker),
        new Promise<symbol>((resolve) => setTimeout(() => resolve(timeoutMarker), GATE_WAIT_MILLISECONDS)),
    ]);
    return winner === resolvedMarker;
}

function makeScriptMayWriteStop(): StoppedWalk {
    return { file: SCRIPT_FILE, eventType: FileEventType.ScriptMayWrite, source: SOURCE_TEXT };
}

async function readStoppedReasonText(t: TestContext, answers: ConsentAnswers): Promise<string> {
    const rootFolder = mkdtempSync(join(realpathSync(tmpdir()), "engine-v3-tui-consent-"));
    t.after(() => rmSync(rootFolder, { recursive: true, force: true }));
    const projectFolder = new Path(join(rootFolder, "project"));
    const file = new Path(join(projectFolder.toString(), PROJECT_FILE_NAME));
    const walkState = createWalkState();
    const requestedWalks: StepRequest[] = [];
    const walker = createHistoryWalker({
        storeFolder: new Path(join(rootFolder, "store")),
        projectFolder,
        walkState,
        requestWalk: (request) => {
            requestedWalks.push(request);
        },
        requestPlay: () => {
            throw new Error("the walker asked for a play that this test does not expect");
        },
        decideScriptAction: (stoppedFile, eventType, source) => decideScriptAction(answers, { file: stoppedFile, eventType, source }),
        onStatusChange: () => {},
    });
    walker.walkHistoryTo(MARKER_TIME, file, true);
    const resultLine: StepResultLine = { startAt: MARKER_TIME.toISOString(), outcome: InverseStepOutcome.UnknownOrRoadblock, commitsWritten: 0, position: 0, commit: "abc", eventType: FileEventType.ScriptMayWrite, source: SOURCE_TEXT };
    const stoppedOutcome: StepProcessOutcome = { kind: StepProcessOutcomeKind.Stopped, eventType: FileEventType.ScriptMayWrite, source: SOURCE_TEXT, lastLine: resultLine };
    await walker.handleOutcome(requestedWalks[0]!, stoppedOutcome);
    const runState = getFileRunState(walkState, file);
    assert.equal(runState.status, FileWalkStatus.Stopped);
    assert.notEqual(runState.reasonText, undefined);
    return runState.reasonText!;
}

test("test_no_question_when_no_script_runs_were_found", () => {
    // Scenario: the project cache counted no script runs.
    // Ask for the next question with no answers and zero scripts of both kinds.
    const question = getNextConsentQuestion(makeAnswers(undefined, undefined), { mayWrite: 0, readOnly: 0 });
    // No question is asked.
    assert.equal(question, undefined);
});

test("test_question_two_is_not_asked_when_only_read_only_scripts_exist", () => {
    // Scenario: 3 read-only scripts and none that may write.
    const scriptCounts = { mayWrite: 0, readOnly: 3 };
    // Question one is asked first and its text holds the counts.
    const questionOne = getNextConsentQuestion(makeAnswers(undefined, undefined), scriptCounts);
    assert.equal(questionOne!.answerKey, "runScripts");
    assert.equal(questionOne!.questionText, "3 script runs were found (0 may write files, 3 only read). Run scripts in the docker container? (y/n)");
    // After a yes to question one, no second question is asked.
    assert.equal(getNextConsentQuestion(makeAnswers(true, undefined), scriptCounts), undefined);
});

test("test_question_two_follows_a_yes_to_question_one", () => {
    // Scenario: 2 scripts may write and 1 only reads.
    const scriptCounts = { mayWrite: 2, readOnly: 1 };
    // With no answers, question one is asked, with N = 3, M = 2, K = 1.
    const questionOne = getNextConsentQuestion(makeAnswers(undefined, undefined), scriptCounts);
    assert.equal(questionOne!.answerKey, "runScripts");
    assert.equal(questionOne!.questionText, "3 script runs were found (2 may write files, 1 only read). Run scripts in the docker container? (y/n)");
    // After a yes to question one, question two is asked.
    const questionTwo = getNextConsentQuestion(makeAnswers(true, undefined), scriptCounts);
    assert.equal(questionTwo!.answerKey, "runModifyingScriptsAutomatically");
    assert.equal(questionTwo!.questionText, "Run the 2 scripts that may write automatically at each script stop? (y/n)");
    // After a no to question one, no further question is asked.
    assert.equal(getNextConsentQuestion(makeAnswers(false, undefined), scriptCounts), undefined);
    // After both answers, no further question is asked.
    assert.equal(getNextConsentQuestion(makeAnswers(true, false), scriptCounts), undefined);
});

test("test_question_one_says_script_run_was_found_when_the_count_is_one", () => {
    // Scenario: the cache counted one script run, and it may write.
    const scriptCounts = { mayWrite: 1, readOnly: 0 };
    // Ask for the next question with no answers.
    const question = getNextConsentQuestion(makeAnswers(undefined, undefined), scriptCounts);
    // The whole text uses the singular form.
    assert.equal(question!.answerKey, "runScripts");
    assert.equal(question!.questionText, "1 script run was found (1 may write files, 0 only read). Run scripts in the docker container? (y/n)");
});

test("test_question_one_says_script_runs_were_found_when_the_count_is_many", () => {
    // Scenario: the cache counted 8 script runs, 1 may write and 7 only read.
    const scriptCounts = { mayWrite: 1, readOnly: 7 };
    // Ask for the next question with no answers.
    const question = getNextConsentQuestion(makeAnswers(undefined, undefined), scriptCounts);
    // The whole text uses the plural form.
    assert.equal(question!.answerKey, "runScripts");
    assert.equal(question!.questionText, "8 script runs were found (1 may write files, 7 only read). Run scripts in the docker container? (y/n)");
});

test("test_question_two_says_script_that_may_write_when_the_count_is_one", () => {
    // Scenario: one script may write and none only read.
    const scriptCounts = { mayWrite: 1, readOnly: 0 };
    // Ask for the next question after a yes to question one.
    const question = getNextConsentQuestion(makeAnswers(true, undefined), scriptCounts);
    // The whole text uses the singular form.
    assert.equal(question!.answerKey, "runModifyingScriptsAutomatically");
    assert.equal(question!.questionText, "Run the 1 script that may write automatically at each script stop? (y/n)");
});

test("test_question_two_says_scripts_that_may_write_when_the_count_is_many", () => {
    // Scenario: two scripts may write and none only read.
    const scriptCounts = { mayWrite: 2, readOnly: 0 };
    // Ask for the next question after a yes to question one.
    const question = getNextConsentQuestion(makeAnswers(true, undefined), scriptCounts);
    // The whole text uses the plural form.
    assert.equal(question!.answerKey, "runModifyingScriptsAutomatically");
    assert.equal(question!.questionText, "Run the 2 scripts that may write automatically at each script stop? (y/n)");
});

test("test_both_yes_runs_a_script_stop_at_once", () => {
    // Scenario: the session answered yes to both questions.
    const answers = makeAnswers(true, true);
    // A stop at a script that may write is run now.
    assert.equal(decideScriptAction(answers, makeScriptMayWriteStop()), ScriptAction.RunNow);
});

test("test_one_yes_waits_for_the_key", () => {
    // Scenario: the session answered yes to question one and no to question two.
    // A stop at a script that may write waits for the play key.
    assert.equal(decideScriptAction(makeAnswers(true, false), makeScriptMayWriteStop()), ScriptAction.WaitForKey);
    // The same holds when question two was never asked.
    assert.equal(decideScriptAction(makeAnswers(true, undefined), makeScriptMayWriteStop()), ScriptAction.WaitForKey);
});

test("test_a_no_refuses_the_play_key_with_a_message", () => {
    // Scenario: the session answered no to question one.
    // A stop at a script that may write is refused, whatever the second answer holds.
    assert.equal(decideScriptAction(makeAnswers(false, undefined), makeScriptMayWriteStop()), ScriptAction.Refuse);
    assert.equal(decideScriptAction(makeAnswers(false, true), makeScriptMayWriteStop()), ScriptAction.Refuse);
});

test("test_with_no_answers_the_play_key_refuses", () => {
    // Scenario: no question was asked because the cache counted no script.
    // A stop at a script that may write is refused.
    assert.equal(decideScriptAction(makeAnswers(undefined, undefined), makeScriptMayWriteStop()), ScriptAction.Refuse);
    // A stop that is not a script is refused as well.
    const nonScriptStop: StoppedWalk = { file: SCRIPT_FILE, eventType: FileEventType.RowBytesUnknown, source: null };
    assert.equal(decideScriptAction(makeAnswers(true, true), nonScriptStop), ScriptAction.Refuse);
});

test("test_the_stop_text_names_the_play_key_only_when_the_key_is_allowed", async (t) => {
    // Scenario: the walker stops at a script that may write, once with each kind of answers.
    // With the key allowed, the stop text names the play key.
    const allowedText = await readStoppedReasonText(t, makeAnswers(true, false));
    assert.ok(allowedText.includes("press the play key"));
    // With scripts refused, the stop text says scripts are not allowed and does not name the play key.
    const refusedText = await readStoppedReasonText(t, makeAnswers(false, undefined));
    assert.ok(refusedText.includes("scripts are not allowed in this session"));
    assert.ok(!refusedText.includes("press the play key"));
});

test("test_the_play_key_acts_on_the_cursor_row_only", () => {
    // Scenario: the cursor is on one file and the selection holds two other files.
    const cursorFile = new Path("/project/cursor.txt");
    const selectedFiles = [new Path("/project/selected_one.txt"), new Path("/project/selected_two.txt")];
    // The play key chooses the cursor file.
    assert.equal(chooseFileForPlayKey(cursorFile, selectedFiles).toString(), cursorFile.toString());
    // The play key chooses the cursor file when the selection is empty.
    assert.equal(chooseFileForPlayKey(cursorFile, []).toString(), cursorFile.toString());
});

test("test_gate_is_open_at_once_when_no_script_run_was_found", async () => {
    // Scenario: the project cache counted no script runs, and no answer was given.
    const answers = makeAnswers(undefined, undefined);
    // Create the gate with zero scripts of both kinds.
    const gate = createConsentGate(answers, { mayWrite: 0, readOnly: 0 });
    // The gate is resolved without any answer.
    assert.equal(await readGateIsResolved(gate.whenAnswered), true);
});

test("test_gate_stays_closed_while_a_question_is_open_and_opens_after_the_last_answer", async () => {
    // Scenario: 1 script may write, and no answer was given.
    const answers = makeAnswers(undefined, undefined);
    const gate = createConsentGate(answers, { mayWrite: 1, readOnly: 0 });
    // The gate is still pending, because question one is open.
    assert.equal(await readGateIsResolved(gate.whenAnswered), false);
    // The first answer is yes, and the caller tells the gate.
    answers.runScripts = true;
    gate.notifyAnswerGiven();
    // The gate is still pending, because question two is open.
    assert.equal(await readGateIsResolved(gate.whenAnswered), false);
    // The second answer is no, and the caller tells the gate.
    answers.runModifyingScriptsAutomatically = false;
    gate.notifyAnswerGiven();
    // The gate is resolved, because no question is open.
    assert.equal(await readGateIsResolved(gate.whenAnswered), true);
});

test("test_gate_opens_after_a_no_to_the_first_question", async () => {
    // Scenario: 1 script may write and 2 only read, and no answer was given.
    const answers = makeAnswers(undefined, undefined);
    const gate = createConsentGate(answers, { mayWrite: 1, readOnly: 2 });
    // The first answer is no, and the caller tells the gate.
    answers.runScripts = false;
    gate.notifyAnswerGiven();
    // The gate is resolved, because a no leaves no second question.
    assert.equal(await readGateIsResolved(gate.whenAnswered), true);
});

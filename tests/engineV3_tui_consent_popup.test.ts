import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { ConsentPopup } from "../engineV3/tui/engineV3_tui_consent_popup.tsx";

const INK_FIRST_RENDER_SETTLE_MILLISECONDS = 50;
const KEY_SETTLE_MILLISECONDS = 50;
const DOWN_ARROW = "\x1b[B";
const ENTER = "\r";
const QUESTION_TEXT = "3 script runs were found (0 may write files, 3 only read). Run scripts in the docker container? (y/n)";

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("test_the_consent_popup_shows_the_question_the_hint_and_two_choices_with_yes_selected", () => {
    // Scenario: the first frame of the popup.
    const { lastFrame, unmount } = render(createElement(ConsentPopup, { questionText: QUESTION_TEXT, terminalRows: 30, terminalColumns: 100, onAnswer: () => {} }));
    const frame = lastFrame() ?? "";
    unmount();
    // the question is there, without the "(y/n)" ending.
    // the popup wraps the long question, so this checks the second half of it.
    assert.ok(frame.includes("scripts in the docker container?"), frame);
    assert.ok(!frame.includes("(y/n)"), frame);
    // the hint line is there.
    assert.ok(frame.includes("use up/down to select, enter to choose."), frame);
    // yes is marked, no is not.
    assert.match(frame, /> yes </);
    assert.doesNotMatch(frame, /> no </);
});

test("test_the_consent_popup_is_in_the_middle_of_the_screen", () => {
    // Scenario: in a screen of 30 rows and 100 columns the popup box does not touch the top or the left side.
    const { lastFrame, unmount } = render(createElement(ConsentPopup, { questionText: QUESTION_TEXT, terminalRows: 30, terminalColumns: 100, onAnswer: () => {} }));
    const lines = (lastFrame() ?? "").split("\n");
    unmount();
    // the top border line of the box is below the first row and starts with spaces.
    const topBorderIndex = lines.findIndex((line) => line.includes("╭"));
    assert.ok(topBorderIndex > 3, `top border at line ${topBorderIndex}`);
    assert.ok(lines[topBorderIndex]!.startsWith("  "), lines[topBorderIndex]);
    // the frame has as many lines as the terminal rows.
    assert.equal(lines.length, 30);
});

test("test_enter_on_yes_answers_true", async (t) => {
    // Scenario: Enter without a move answers yes.
    const answers: boolean[] = [];
    const { stdin, unmount } = render(createElement(ConsentPopup, { questionText: QUESTION_TEXT, terminalRows: 30, terminalColumns: 100, onAnswer: (answer: boolean) => answers.push(answer) }));
    t.after(() => unmount());
    await waitMilliseconds(INK_FIRST_RENDER_SETTLE_MILLISECONDS);
    stdin.write(ENTER);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    assert.deepEqual(answers, [true]);
});

test("test_down_then_enter_answers_false", async (t) => {
    // Scenario: Down moves the mark to no; Enter answers no.
    const answers: boolean[] = [];
    const { stdin, unmount } = render(createElement(ConsentPopup, { questionText: QUESTION_TEXT, terminalRows: 30, terminalColumns: 100, onAnswer: (answer: boolean) => answers.push(answer) }));
    t.after(() => unmount());
    await waitMilliseconds(INK_FIRST_RENDER_SETTLE_MILLISECONDS);
    stdin.write(DOWN_ARROW);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    stdin.write(ENTER);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    assert.deepEqual(answers, [false]);
});

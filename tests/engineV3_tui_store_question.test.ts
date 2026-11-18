import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { StoreAnswer, StoreQuestion } from "../engineV3/tui/engineV3_tui_store_question.ts";

const INK_FIRST_RENDER_SETTLE_MILLISECONDS = 50;
const KEY_SETTLE_MILLISECONDS = 50;
const DOWN_ARROW = "\x1b[B";
const UP_ARROW = "\x1b[A";
const ENTER = "\r";

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("test_the_store_question_shows_the_text_and_the_abort_row_selected_first", () => {
    // Scenario: the first frame shows the three text lines and the two choices; the abort row is selected.
    // render the question.
    const { lastFrame, unmount } = render(createElement(StoreQuestion, { onAnswer: () => {} }));
    const frame = lastFrame() ?? "";
    unmount();
    // the frame shows the text lines.
    assert.match(frame, /the store holds a full-build repo\./);
    assert.match(frame, /Do you wish to abort the build or Reset the store\?/);
    assert.match(frame, /use up\/down to select, enter to choose\./);
    // the abort row is marked as selected, and the reset row is not.
    assert.match(frame, /> abort the build and exit the program </);
    assert.doesNotMatch(frame, /> reset the store and continue the load </);
});

test("test_enter_on_the_first_row_answers_abort", async (t) => {
    // Scenario: Enter without a move answers abort.
    const answers: StoreAnswer[] = [];
    const { stdin, unmount } = render(createElement(StoreQuestion, { onAnswer: (answer) => answers.push(answer) }));
    t.after(() => unmount());
    await waitMilliseconds(INK_FIRST_RENDER_SETTLE_MILLISECONDS);
    // press Enter.
    stdin.write(ENTER);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    // the answer is abort.
    assert.deepEqual(answers, [StoreAnswer.Abort]);
});

test("test_down_then_enter_answers_reset_and_the_reset_row_shows_the_marks", async (t) => {
    // Scenario: Down moves the mark to the reset row; Enter answers reset.
    const answers: StoreAnswer[] = [];
    const { lastFrame, stdin, unmount } = render(createElement(StoreQuestion, { onAnswer: (answer) => answers.push(answer) }));
    t.after(() => unmount());
    await waitMilliseconds(INK_FIRST_RENDER_SETTLE_MILLISECONDS);
    // press Down.
    stdin.write(DOWN_ARROW);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    // the reset row is marked.
    assert.match(lastFrame() ?? "", /> reset the store and continue the load </);
    // press Enter.
    stdin.write(ENTER);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    // the answer is reset.
    assert.deepEqual(answers, [StoreAnswer.Reset]);
});

test("test_up_after_down_moves_the_mark_back_to_the_abort_row", async (t) => {
    // Scenario: Down then Up returns to the abort row; Enter answers abort.
    const answers: StoreAnswer[] = [];
    const { stdin, unmount } = render(createElement(StoreQuestion, { onAnswer: (answer) => answers.push(answer) }));
    t.after(() => unmount());
    await waitMilliseconds(INK_FIRST_RENDER_SETTLE_MILLISECONDS);
    // press Down, Up, Enter.
    stdin.write(DOWN_ARROW);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    stdin.write(UP_ARROW);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    stdin.write(ENTER);
    await waitMilliseconds(KEY_SETTLE_MILLISECONDS);
    // the answer is abort.
    assert.deepEqual(answers, [StoreAnswer.Abort]);
});

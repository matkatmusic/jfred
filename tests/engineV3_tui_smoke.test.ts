// Smoke test of the terminal UI packages: Ink renders text, and ink-testing-library delivers key presses.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useState } from "react";
import { Text, useInput } from "ink";
import { render } from "ink-testing-library";

const FRAME_POLL_INTERVAL_MILLISECONDS = 10;
const FRAME_WAIT_LIMIT_MILLISECONDS = 2000;
const INK_FIRST_RENDER_SETTLE_MILLISECONDS = 50;
const XTERM_SHIFT_LEFT_ARROW_SEQUENCE = "\x1b[1;2D";

function waitMilliseconds(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFrame(lastFrame: () => string | undefined, expectedText: string): Promise<void> {
    const pollCountLimit = FRAME_WAIT_LIMIT_MILLISECONDS / FRAME_POLL_INTERVAL_MILLISECONDS;
    for (let pollCount = 0; pollCount < pollCountLimit; pollCount++) {
        const frame = lastFrame() ?? "";
        if (frame.includes(expectedText)) {
            return;
        }
        await waitMilliseconds(FRAME_POLL_INTERVAL_MILLISECONDS);
    }
    throw new Error(`Frame never showed "${expectedText}" within ${FRAME_WAIT_LIMIT_MILLISECONDS} ms. Last frame: ${lastFrame()}`);
}

function ShowKeys() {
    const [keyState, setKeyState] = useState({ leftArrow: false, shift: false });
    useInput((input, key) => {
        setKeyState({ leftArrow: key.leftArrow, shift: key.shift });
    });
    return createElement(Text, null, `leftArrow=${keyState.leftArrow} shift=${keyState.shift}`);
}

test("test_ink_testing_library_renders_a_text_element_and_reads_the_frame", () => {
    // Scenario: Ink draws a Text element and ink-testing-library hands the drawn frame back.
    // Render a Text element that holds "hi".
    const { lastFrame, unmount } = render(createElement(Text, null, "hi"));
    // The last frame contains "hi".
    assert.match(lastFrame() ?? "", /hi/);
    // Remove the element so the test process can end.
    unmount();
});

test("test_ink_testing_library_delivers_a_shift_left_arrow_to_useInput", async (t) => {
    // Scenario: A Shift-Left key press written to the fake stdin reaches useInput with leftArrow and shift both true.
    // Render the component that shows the key state; it starts as false and false.
    const { lastFrame, stdin, unmount } = render(createElement(ShowKeys));
    // Remove the component at the end, also when an assertion fails.
    t.after(() => unmount());
    // The first frame shows both flags false.
    assert.match(lastFrame() ?? "", /leftArrow=false shift=false/);
    // Ink reads input only after the first render effect has run, so wait a short time.
    await waitMilliseconds(INK_FIRST_RENDER_SETTLE_MILLISECONDS);
    // Write the xterm Shift-Left sequence to the fake stdin.
    stdin.write(XTERM_SHIFT_LEFT_ARROW_SEQUENCE);
    // Wait until the frame shows both flags true.
    await waitForFrame(lastFrame, "leftArrow=true shift=true");
    // The frame shows both flags true.
    assert.match(lastFrame() ?? "", /leftArrow=true shift=true/);
});

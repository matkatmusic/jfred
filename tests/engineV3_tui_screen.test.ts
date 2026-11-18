import assert from "node:assert/strict";
import { test } from "node:test";
import { CLEAR_SCREEN_SEQUENCE, ENTER_ALTERNATE_SCREEN_SEQUENCE, LEAVE_ALTERNATE_SCREEN_SEQUENCE, clearTerminalScreen, enterAlternateScreen, leaveAlternateScreen } from "../engineV3/tui/engineV3_tui_screen.ts";

test("test_enterAlternateScreen_and_leaveAlternateScreen_write_the_alternate_screen_sequences", () => {
    // Scenario: the TUI opens the blank alternate screen at the start and gives the old screen back at the end.
    // a fake output stream collects what is written.
    const written: string[] = [];
    const output = { write: (text: string) => written.push(text) };
    // the TUI enters and then leaves the alternate screen.
    enterAlternateScreen(output);
    leaveAlternateScreen(output);
    // the stream got the enter sequence first and the leave sequence second.
    assert.deepEqual(written, [ENTER_ALTERNATE_SCREEN_SEQUENCE, LEAVE_ALTERNATE_SCREEN_SEQUENCE]);
    assert.equal(ENTER_ALTERNATE_SCREEN_SEQUENCE, "\x1b[?1049h");
    assert.equal(LEAVE_ALTERNATE_SCREEN_SEQUENCE, "\x1b[?1049l");
});

test("test_clearTerminalScreen_writes_the_clear_screen_sequence_and_moves_the_cursor_home", () => {
    // Scenario: the TUI start clears the screen through the output stream.
    // a fake output stream collects what is written.
    const written: string[] = [];
    // the screen is cleared.
    clearTerminalScreen({ write: (text: string) => written.push(text) });
    // the stream got the clear sequence once: erase the screen (2J) and move the cursor to the top left (H).
    assert.deepEqual(written, [CLEAR_SCREEN_SEQUENCE]);
    assert.equal(CLEAR_SCREEN_SEQUENCE, "\x1b[2J\x1b[H");
});

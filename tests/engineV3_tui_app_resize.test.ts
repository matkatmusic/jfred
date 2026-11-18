// The root component draws again at the new size when the terminal is resized.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createElement } from "react";
import { render } from "ink";
import { App } from "../engineV3/tui/engineV3_tui_app.tsx";
import { makeAppProps, waitMilliseconds, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

const START_COLUMNS = 100;
const START_ROWS = 40;
const SMALL_COLUMNS = 80;
const SMALL_ROWS = 30;
const SETTLE_MILLISECONDS = 150;
const COLOR_CODE_PATTERN = /\x1b\[[0-9;]*m/g;

// ink-testing-library fixes the size at 100 columns, so this test uses an output stream whose size it can change.
class ResizableStdout extends EventEmitter {
    columns = START_COLUMNS;
    rows = START_ROWS;
    lastFrame = "";
    write = (frame: string) => {
        if (frame.trim() !== "") {
            this.lastFrame = frame;
        }
    };
}

class FakeStdin extends EventEmitter {
    isTTY = true;
    setEncoding() {}
    setRawMode() {}
    resume() {}
    pause() {}
    ref() {}
    unref() {}
    read = () => null;
}

test("test_a_resize_of_the_terminal_draws_the_boxes_at_the_new_size", async (t) => {
    // Scenario: the screen is drawn at 100 columns and 40 rows.
    const project = writeLongProject(t, true);
    const stdout = new ResizableStdout();
    const instance = render(createElement(App, makeAppProps(project, { terminalRows: START_ROWS, terminalColumns: START_COLUMNS })), { stdout: stdout as never, stdin: new FakeStdin() as never, debug: true, exitOnCtrlC: false, patchConsole: false });
    t.after(() => instance.unmount());
    await waitMilliseconds(SETTLE_MILLISECONDS);
    const startLines = stdout.lastFrame.replace(COLOR_CODE_PATTERN, "").split("\n");
    assert.equal(startLines[0]!.length, START_COLUMNS);
    assert.equal(startLines.length, START_ROWS);
    // the terminal shrinks to 80 columns and 30 rows, and tells the stream.
    stdout.columns = SMALL_COLUMNS;
    stdout.rows = SMALL_ROWS;
    stdout.emit("resize");
    await waitMilliseconds(SETTLE_MILLISECONDS);
    // the first box line is 80 columns wide and the frame has 30 lines.
    const smallLines = stdout.lastFrame.replace(COLOR_CODE_PATTERN, "").split("\n");
    assert.equal(smallLines[0]!.length, SMALL_COLUMNS);
    assert.equal(smallLines.length, SMALL_ROWS);
});

// The Engine Console box in the root component.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineLogLineKind, type EngineLog, type EngineLogLine } from "../engineV3/tui/engineV3_tui_engine_log.ts";
import { startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

const UP_ARROW = "\x1b[A";

function makeFakeEngineLog(lines: EngineLogLine[]): EngineLog {
    return { appendRawLine: () => {}, appendSummaryLine: () => {}, listLines: () => lines };
}

function makeHundredLines(): EngineLogLine[] {
    return Array.from({ length: 100 }, (_, index) => ({ kind: EngineLogLineKind.Raw, text: `log-line ${index}` }));
}

test("test_the_c_key_opens_the_console_with_the_log_lines_and_the_console_keys", async (t) => {
    // Scenario: the log holds one summary line and one raw line.
    const engineLog = makeFakeEngineLog([{ kind: EngineLogLineKind.Summary, text: "summary-line" }, { kind: EngineLogLineKind.Raw, text: "[a.txt] raw-line" }]);
    const screen = await startScreen(t, writeLongProject(t, false), { engineLog });
    // before c the console is closed.
    assert.ok(!screen.frame().includes("Console:"));
    // after c both lines show and the hotkeys box names the console keys.
    await screen.press("c");
    assert.ok(screen.frame().includes("summary-line"));
    assert.ok(screen.frame().includes("[a.txt] raw-line"));
    assert.ok(screen.frame().includes("o: open log folder"));
});

test("test_the_info_box_is_hidden_while_the_console_is_open_and_shows_again_after_it_closes", async (t) => {
    // Scenario: the Info Box shows its counts row.
    const screen = await startScreen(t, writeLongProject(t, false), { engineLog: makeFakeEngineLog([]) });
    assert.ok(screen.frame().includes("modifying events in the log"));
    // the console is open: the Info Box is hidden.
    await screen.press("c");
    assert.ok(!screen.frame().includes("modifying events in the log"));
    // the console is closed: the Info Box shows again.
    await screen.press("c");
    assert.ok(screen.frame().includes("modifying events in the log"));
});

test("test_the_o_key_calls_open_log_folder_only_in_the_console", async (t) => {
    // Scenario: a fake open function counts its calls.
    let callCount = 0;
    const screen = await startScreen(t, writeLongProject(t, false), { engineLog: makeFakeEngineLog([]), openLogFolder: () => { callCount += 1; } });
    // o in the file list calls nothing.
    await screen.press("o");
    assert.equal(callCount, 0);
    // o in the console calls it once.
    await screen.press("c");
    await screen.press("o");
    assert.equal(callCount, 1);
});

test("test_the_c_key_closes_the_console", async (t) => {
    const screen = await startScreen(t, writeLongProject(t, false), { engineLog: makeFakeEngineLog([]) });
    await screen.press("c");
    assert.ok(screen.frame().includes("Console:"));
    await screen.press("c");
    assert.ok(!screen.frame().includes("Console:"));
});

test("test_the_console_shows_the_end_of_the_log_and_the_up_arrow_scrolls_back", async (t) => {
    // Scenario: 100 log lines.
    const screen = await startScreen(t, writeLongProject(t, false), { engineLog: makeFakeEngineLog(makeHundredLines()) });
    await screen.press("c");
    // the last line shows first.
    assert.ok(screen.frame().includes("log-line 99"));
    // one press of the up arrow scrolls the last line out.
    await screen.press(UP_ARROW);
    assert.ok(!screen.frame().includes("log-line 99"));
    assert.ok(screen.frame().includes("log-line 98"));
});

test("test_the_view_file_box_and_the_console_are_never_open_together", async (t) => {
    // Scenario: the console is open on a walked file.
    const screen = await startScreen(t, writeLongProject(t, true), { engineLog: makeFakeEngineLog([]) });
    await screen.press("c");
    // the v key does nothing in the console.
    await screen.press("v");
    assert.ok(!screen.frame().includes("View file:"));
    // close the console, open the View File box: the c key closes it and the console stays closed.
    await screen.press("c");
    await screen.press("v");
    assert.ok(screen.frame().includes("View file:"));
    await screen.press("c");
    assert.ok(!screen.frame().includes("View file:"));
    assert.ok(!screen.frame().includes("Console:"));
});

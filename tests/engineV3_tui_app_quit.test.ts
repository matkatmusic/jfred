// The q key quits the viewer from every screen. The root component subscribes to status changes and unsubscribes when it unmounts, so the unsubscribe call shows the quit.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { JumpSpeed } from "../src/structures/vocabulary.ts";
import { buildHotKeyRows, formatHotKeyRowText } from "../engineV3/tui/engineV3_tui_hotkeys_rows.ts";
import { KeyBox, loadKeyBoxes } from "../engineV3/tui/engineV3_tui_keymap.ts";
import { startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

const KEYMAP_FILE = new Path(join(import.meta.dirname, "..", "engineV3", "tui", "keymap.json"));

function makeSubscriptionRecorder() {
    const recorder = { isSubscribed: false, subscribeToStatusChanges: (): (() => void) => {
        recorder.isSubscribed = true;
        return () => { recorder.isSubscribed = false; };
    } };
    return recorder;
}

async function startScreenWithRecorder(t: TestContext) {
    const recorder = makeSubscriptionRecorder();
    const screen = await startScreen(t, writeLongProject(t, true), { subscribeToStatusChanges: recorder.subscribeToStatusChanges });
    return { recorder, screen };
}

test("test_q_quits_from_the_file_list", async (t) => {
    // Scenario: the file list shows and the viewer runs.
    const { recorder, screen } = await startScreenWithRecorder(t);
    assert.equal(recorder.isSubscribed, true);
    // the q key unmounts the viewer.
    await screen.press("q");
    assert.equal(recorder.isSubscribed, false);
});

test("test_q_quits_from_the_view_file_box", async (t) => {
    // Scenario: the View File box is open.
    const { recorder, screen } = await startScreenWithRecorder(t);
    await screen.press("v");
    assert.ok(screen.frame().includes("Up: scroll up"));
    // the q key unmounts the viewer.
    await screen.press("q");
    assert.equal(recorder.isSubscribed, false);
});

test("test_q_quits_from_the_console_box", async (t) => {
    // Scenario: the Console box is open.
    const { recorder, screen } = await startScreenWithRecorder(t);
    await screen.press("c");
    assert.equal(recorder.isSubscribed, true);
    // the q key unmounts the viewer.
    await screen.press("q");
    assert.equal(recorder.isSubscribed, false);
});

test("test_the_hotkeys_box_shows_q_quit_on_every_screen", async (t) => {
    // Scenario: the file list, then the View File box, then the Console box.
    const { screen } = await startScreenWithRecorder(t);
    // the file list hotkey rows hold "q: quit". The test screen is 100 columns wide and cuts the long Actions row, so the rows are checked, not the frame.
    const globalRowTexts = buildHotKeyRows(loadKeyBoxes(KEYMAP_FILE)[KeyBox.Global], JumpSpeed.Event).map(formatHotKeyRowText);
    assert.ok(globalRowTexts.some((rowText) => rowText.includes("q: quit")), globalRowTexts.join("\n"));
    // the View File box hotkeys show "q: quit".
    await screen.press("v");
    assert.ok(screen.frame().includes("q: quit"), screen.frame());
    // the Console box hotkeys show "q: quit".
    await screen.press("c");
    await screen.press("c");
    assert.ok(screen.frame().includes("q: quit"), screen.frame());
});

// Key g reconstructs the file under the cursor back to the Earliest time.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Path } from "../src/structures/domain.ts";
import { FileWalkStatus } from "../src/structures/vocabulary.ts";
import { createWalkState, setFileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import { startScreen, writeLongProject } from "./engineV3_tui_app_real_harness.ts";

type WalkCall = { currentTime: Date; file: Path; isVisible: boolean };

function makeRecordingWalker(calls: WalkCall[]) {
    return {
        walkHistoryTo: (currentTime: Date, file: Path, isVisible: boolean) => {
            calls.push({ currentTime, file, isVisible });
            return false;
        },
        handleOutcome: async () => {},
        playScript: async () => {},
    };
}

test("test_the_g_key_asks_the_walker_to_walk_the_cursor_file_to_time_zero_as_visible", async (t) => {
    // Scenario: no walk request is made at the start, because the history of the file is spanned.
    const calls: WalkCall[] = [];
    const project = writeLongProject(t, true);
    const screen = await startScreen(t, project, { walker: makeRecordingWalker(calls) });
    assert.equal(calls.length, 0);
    // the g key makes one request for the cursor file at time zero, shown as visible.
    await screen.press("g");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.currentTime.getTime(), 0);
    assert.equal(calls[0]!.file.value, project.file.value);
    assert.equal(calls[0]!.isVisible, true);
});

test("test_the_g_key_is_ignored_while_the_cursor_file_run_is_queued_or_running_and_works_after_it_ends", async (t) => {
    // Scenario: the run of the cursor file is Running.
    const calls: WalkCall[] = [];
    const project = writeLongProject(t, true);
    const walkState = createWalkState();
    setFileRunState(walkState, project.file, { status: FileWalkStatus.Running, reasonText: undefined, failedReplayCount: 0 });
    const screen = await startScreen(t, project, { walker: makeRecordingWalker(calls), walkState });
    // the g key makes no request.
    await screen.press("g");
    assert.equal(calls.length, 0);
    // the run is Queued: the g key makes no request.
    setFileRunState(walkState, project.file, { status: FileWalkStatus.Queued, reasonText: undefined, failedReplayCount: 0 });
    await screen.press("g");
    assert.equal(calls.length, 0);
    // the run ends (Idle): the g key makes one request.
    setFileRunState(walkState, project.file, { status: FileWalkStatus.Idle, reasonText: undefined, failedReplayCount: 0 });
    await screen.press("g");
    assert.equal(calls.length, 1);
});

test("test_the_g_key_does_nothing_while_the_console_is_open", async (t) => {
    // Scenario: the console is open.
    const calls: WalkCall[] = [];
    const screen = await startScreen(t, writeLongProject(t, true), { walker: makeRecordingWalker(calls) });
    await screen.press("c");
    // the g key makes no request.
    await screen.press("g");
    assert.equal(calls.length, 0);
});

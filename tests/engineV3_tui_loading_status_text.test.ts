import test from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import { FileWalkStatus } from "../src/structures/vocabulary.ts";
import { createWalkState, setFileRunState } from "../engineV3/tui/engineV3_tui_walk_state.ts";
import { getLoadingStatusText } from "../engineV3/tui/engineV3_tui_app_rows.ts";

const FILES = [new Path("/project/a.ts"), new Path("/project/b.ts")];

function makeRunState(status: FileWalkStatus) {
    return { status, reasonText: undefined, failedReplayCount: 0 };
}

test("test_the_status_text_is_empty_when_no_file_is_queued_or_running", () => {
    // Scenario: one file is Stopped and one file has no run state; the status text stays undefined.
    const walkState = createWalkState();
    setFileRunState(walkState, FILES[0]!, makeRunState(FileWalkStatus.Stopped));
    assert.equal(getLoadingStatusText(walkState, FILES), undefined);
});

test("test_the_status_text_says_loading_when_a_file_is_queued", () => {
    // Scenario: file b is Queued; the status text says loading.
    const walkState = createWalkState();
    setFileRunState(walkState, FILES[1]!, makeRunState(FileWalkStatus.Queued));
    assert.equal(getLoadingStatusText(walkState, FILES), "loading");
});

test("test_the_status_text_says_loading_when_a_file_is_running", () => {
    // Scenario: file a is Running; the status text says loading.
    const walkState = createWalkState();
    setFileRunState(walkState, FILES[0]!, makeRunState(FileWalkStatus.Running));
    assert.equal(getLoadingStatusText(walkState, FILES), "loading");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    createScriptExecutionEvent,
    getImmediatePostExecutionState,
    matchLinesToBeacon,
} from "../src/reconstruction_script_stage_beacon.ts";
import type { BeaconSnippet } from "../src/reconstruction_user_edit.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import type { UserEditEvent } from "../src/reconstruction_events.ts";
import { EventKind } from "../src/structures/vocabulary.ts";
import { Path, Uuid } from "../src/structures/domain.ts";

function buildSnippet(lines: Array<{ lineNo: number; text: string }>): BeaconSnippet {
    return { lines, hasEllipsis: false };
}

test("test_match_accepts_a_window_that_matches_every_visible_line", () => {
    const snippet = buildSnippet([{ lineNo: 2, text: "b" }, { lineNo: 3, text: "c" }]);
    assert.equal(matchLinesToBeacon(["a", "b", "c", "d"], snippet), true);
});

test("test_match_rejects_a_different_line_or_a_line_past_the_end", () => {
    assert.equal(matchLinesToBeacon(["a", "x"], buildSnippet([{ lineNo: 2, text: "b" }])), false);
    assert.equal(matchLinesToBeacon(["a"], buildSnippet([{ lineNo: 2, text: "b" }])), false);
});

test("test_post_execution_state_is_the_beacon_content_itself", () => {
    assert.equal(getImmediatePostExecutionState("abc\n"), "abc\n");
});

test("test_script_execution_event_keeps_beacon_identity_with_run_timestamp", () => {
    const beacon: UserEditEvent = {
        kind: EventKind.userEdit, changeId: new Uuid("u1"),
        target: new Path("/w/f.py"), content: "old", timestamp: new Date(1),
    };
    const run: ScriptRun = { code: "print(1)", timestamp: new Date(2) };
    const event = createScriptExecutionEvent(beacon, "new", run);
    assert.equal(event.kind, EventKind.scriptExecution);
    assert.equal(event.changeId, beacon.changeId);
    assert.equal(event.content, "new");
    assert.equal(event.timestamp, run.timestamp);
});

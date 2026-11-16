// Task 580: the refusal reason of an unsupported command line travels from the engine to the run console notes (no docker).

import assert from "node:assert/strict";
import { test } from "node:test";
import { ScriptExecutorKind } from "../src/reconstruction_script_execution.ts";
import { Path } from "../src/structures/domain.ts";
import { mapScriptTaskOutcomeToWire } from "../src/viewer_api_layer1_script_replay.ts";
import { listRunConsoleNotes } from "../webapp/layer1-components/details-drawer/layer1-run-console-data.ts";
import { WireRunOutcome, WireRunStreamKind, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { ScriptReplayTaskRecord } from "./engineV3_script_replay_gaps.ts";
import { ScriptTaskOutcomeKind, getScriptReplayRefusal, type ScriptTaskOutcome } from "./engineV3_script_replay_run.ts";

const PROJECT_FOLDER = "/Users/example/proj";

function makeRecord(): ScriptReplayTaskRecord {
    return {
        taskId: "task-1",
        instant: "2026-01-01T00:00:00.000Z",
        jsonlPath: "/Users/example/logs/session.jsonl",
        line: 1,
        toolUseId: null,
        executorKind: ScriptExecutorKind.bash,
        language: "bash",
        cwd: PROJECT_FOLDER,
        code: "python3 move.py $(date)",
        invokedScriptPath: "move.py",
        invokedCommand: "python3 move.py $(date)",
        runInBackground: false,
    };
}

function makeRefusedOutcome(reason: string): ScriptTaskOutcome {
    return {
        taskId: "task-1",
        outcome: ScriptTaskOutcomeKind.Refused,
        reason,
        missingExecutable: null,
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        files: [],
    };
}

// No page function turns a wire task result into a WireScriptResult, so this local copy builds it the way tests/layer1-run-console-data.test.ts buildResult does.
function buildScriptResult(overrides: Partial<WireScriptResult>): WireScriptResult {
    return { kind: WireRunStreamKind.result, toolUseId: "toolu_1", outcome: WireRunOutcome.replayed, files: [], stdout: "", stderr: "", timedOut: false, isOutputSaved: true, ...overrides };
}

test("test_a_refusal_reason_of_an_unsupported_command_line_reaches_the_run_console_notes", () => {
    // Scenario: the reason that getScriptReplayRefusal gives for `python3 move.py $(date)` is shown in the run console notes.
    // Steps:
    // (1) A record holds the command line `python3 move.py $(date)` and the script path `move.py`.
    const record = makeRecord();
    // (2) The engine refuses the record with a reason text.
    const reason = getScriptReplayRefusal(record, new Path(PROJECT_FOLDER));
    assert.equal(typeof reason, "string");
    // (3) The task outcome is Refused and holds that reason.
    const outcome = makeRefusedOutcome(reason as string);
    // (4) The wire result is notReplayed and holds the reason text.
    const wireResult = mapScriptTaskOutcomeToWire(outcome);
    assert.equal(wireResult.outcome, WireRunOutcome.notReplayed);
    assert.equal(wireResult.reason, reason);
    // (5) The page result is built from the wire result.
    const scriptResult = buildScriptResult({ outcome: wireResult.outcome, reason: wireResult.reason });
    // (6) The run console notes hold the reason text.
    assert.ok(listRunConsoleNotes(scriptResult).includes(reason as string));
});

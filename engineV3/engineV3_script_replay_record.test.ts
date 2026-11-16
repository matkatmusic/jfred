import { test } from "node:test";
import assert from "node:assert/strict";

import { Path, Uuid } from "../src/structures/domain.ts";
import { ScriptExecutorKind, type ScriptRun } from "../src/reconstruction_script_execution.ts";
import { convertScriptRunToTaskRecord, convertTaskRecordToScriptRun } from "./engineV3_script_replay_gaps.ts";

const JSONL_PATH = "/Users/example/logs/session.jsonl";
const INVOKED_COMMAND = "NAME=v python3 move.py a";

function makeScriptRun(): ScriptRun {
    return {
        code: "print(1)",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        cwd: new Path("/Users/example/project"),
        source: { filePath: JSONL_PATH, lineNumber: 7 },
        toolUseId: new Uuid("toolu_example01"),
        executorKind: ScriptExecutorKind.python,
        language: "python",
        invokedScriptPath: "move.py",
        runInBackground: false,
    };
}

test("test_convertScriptRunToTaskRecord_keeps_the_invoked_command", () => {
    // Scenario: the record copies the typed command line of a script run, and has no such key when the run has none.
    // Steps:
    // a script run has the invoked command "NAME=v python3 move.py a".
    const runWithCommand: ScriptRun = { ...makeScriptRun(), invokedCommand: INVOKED_COMMAND };
    // the run is converted to a task record.
    const recordWithCommand = convertScriptRunToTaskRecord(runWithCommand);
    // the record holds that same text.
    assert.equal(recordWithCommand.invokedCommand, INVOKED_COMMAND);
    // a second script run has no invoked command.
    const runWithoutCommand = makeScriptRun();
    // that run is converted to a task record.
    const recordWithoutCommand = convertScriptRunToTaskRecord(runWithoutCommand);
    // the record has no invokedCommand key at all.
    assert.equal("invokedCommand" in recordWithoutCommand, false);
});

test("test_convertTaskRecordToScriptRun_restores_the_invoked_command", () => {
    // Scenario: a run keeps its invoked command through run, record, run.
    // Steps:
    // a script run has the invoked command "NAME=v python3 move.py a".
    const runWithCommand: ScriptRun = { ...makeScriptRun(), invokedCommand: INVOKED_COMMAND };
    // the run is converted to a task record.
    const record = convertScriptRunToTaskRecord(runWithCommand);
    // the record is converted back to a script run.
    const restoredRun = convertTaskRecordToScriptRun(record);
    // the restored run holds the same invoked command.
    assert.equal(restoredRun.invokedCommand, INVOKED_COMMAND);
});

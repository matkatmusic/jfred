import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import { ScriptExecutorKind } from "../src/reconstruction_script_execution.ts";
import type { ScriptReplayInputFile } from "./engineV3_script_replay_container.ts";
import type { ScriptReplayTaskRecord } from "./engineV3_script_replay_gaps.ts";
import { buildScriptReplayRequest } from "./engineV3_script_replay_run.ts";

const PROJECT_ROOT = new Path("/Users/example/proj");
const TIMEOUT_SECONDS = 60;
const NO_INPUTS: ScriptReplayInputFile[] = [];

function makePythonRecord(invokedScriptPath: string, invokedCommand: string | undefined): ScriptReplayTaskRecord {
    const record: ScriptReplayTaskRecord = {
        taskId: "task-1",
        instant: "2026-01-01T00:00:00.000Z",
        jsonlPath: "/Users/example/logs/session.jsonl",
        line: 7,
        toolUseId: "toolu_example01",
        executorKind: ScriptExecutorKind.python,
        language: "python",
        cwd: "/Users/example/proj",
        code: "print(1)",
        invokedScriptPath,
        runInBackground: false,
    };
    if (invokedCommand !== undefined) {
        record.invokedCommand = invokedCommand;
    }
    return record;
}

test("test_buildScriptReplayRequest_carries_the_words_and_settings", () => {
    // Scenario: the typed command line gives the request its argument words and its environment settings.
    // Steps:
    // a python record ran the script "move.py" with the command 'NAME=v python3 move.py a "b c"'.
    const record = makePythonRecord("move.py", 'NAME=v python3 move.py a "b c"');
    // the request is built from that record.
    const request = buildScriptReplayRequest(record, PROJECT_ROOT, NO_INPUTS, TIMEOUT_SECONDS);
    // the words are "a" and "b c": the quoted part is one word.
    assert.deepEqual(request.commandWords, ["a", "b c"]);
    // the settings hold NAME=v.
    assert.deepEqual(request.environmentSettings, { NAME: "v" });
});

test("test_buildScriptReplayRequest_without_an_invoked_command_has_no_words", () => {
    // Scenario: a record without a typed command line gives a request with no words and no settings.
    // Steps:
    // a python record has the script "move.py" and no invoked command.
    const record = makePythonRecord("move.py", undefined);
    // the request is built from that record.
    const request = buildScriptReplayRequest(record, PROJECT_ROOT, NO_INPUTS, TIMEOUT_SECONDS);
    // the words are empty.
    assert.deepEqual(request.commandWords, []);
    // the settings are empty.
    assert.deepEqual(request.environmentSettings, {});
});

test("test_buildScriptReplayRequest_follows_the_cd_prefix", () => {
    // Scenario: a "cd" before the script moves the start folder and the import folder into that folder.
    // Steps:
    // a python record at "/Users/example/proj" ran the command "cd sub && python3 move.py".
    const record = makePythonRecord("move.py", "cd sub && python3 move.py");
    // the request is built from that record.
    const request = buildScriptReplayRequest(record, PROJECT_ROOT, NO_INPUTS, TIMEOUT_SECONDS);
    // the start folder of the request is "/Users/example/proj/sub".
    assert.equal(request.cwd, "/Users/example/proj/sub");
    // the import folder of the request is "/Users/example/proj/sub".
    assert.equal(request.pythonImportFolder, "/Users/example/proj/sub");
});

test("test_buildScriptReplayRequest_keeps_the_exec_open_run_unchanged", () => {
    // Scenario: a run made with exec(open(...).read()) gives no words, no settings, and keeps its start folder.
    // Steps:
    // a python record at "/Users/example/proj" ran the script "x.py" with the command 'exec(open("x.py").read())'.
    const record = makePythonRecord("x.py", 'exec(open("x.py").read())');
    // the request is built from that record.
    const request = buildScriptReplayRequest(record, PROJECT_ROOT, NO_INPUTS, TIMEOUT_SECONDS);
    // the words are empty.
    assert.deepEqual(request.commandWords, []);
    // the settings are empty.
    assert.deepEqual(request.environmentSettings, {});
    // the start folder of the request is still "/Users/example/proj".
    assert.equal(request.cwd, "/Users/example/proj");
});

test("test_buildScriptReplayRequest_throws_on_an_unsupported_command_line", () => {
    // Scenario: a command line the replay cannot expand never gives a request.
    // Steps:
    // a python record ran the script "move.py" with the command "python3 move.py $(date)".
    const record = makePythonRecord("move.py", "python3 move.py $(date)");
    // building the request throws an error that says the line uses "$".
    assert.throws(() => buildScriptReplayRequest(record, PROJECT_ROOT, NO_INPUTS, TIMEOUT_SECONDS), /uses \$/);
});

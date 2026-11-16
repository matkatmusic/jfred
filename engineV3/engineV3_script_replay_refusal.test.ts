import { test } from "node:test";
import assert from "node:assert/strict";

import { Path } from "../src/structures/domain.ts";
import { ScriptExecutorKind } from "../src/reconstruction_script_execution.ts";
import type { ScriptReplayTaskRecord } from "./engineV3_script_replay_gaps.ts";
import { getScriptReplayRefusal } from "./engineV3_script_replay_run.ts";

const PROJECT_FOLDER = new Path("/Users/example/proj");

function makeRecord(cwd: string, invokedCommand: string, invokedScriptPath: string | null): ScriptReplayTaskRecord {
    return {
        taskId: "task-1",
        instant: "2026-01-01T00:00:00.000Z",
        jsonlPath: "/Users/example/logs/session.jsonl",
        line: 7,
        toolUseId: "toolu_example01",
        executorKind: ScriptExecutorKind.python,
        language: "python",
        cwd,
        code: "print(1)",
        invokedScriptPath,
        invokedCommand,
        runInBackground: false,
    };
}

test("test_getScriptReplayRefusal_refuses_an_unreadable_command_line", () => {
    // Scenario: a command line the replay cannot expand ($) is refused, but only when the script path is known.
    // Steps:
    // a record has the command line "python3 move.py $(date)" and the script path "move.py".
    const recordWithScript = makeRecord("/Users/example/proj", "python3 move.py $(date)", "move.py");
    // the refusal is asked for.
    const refusal = getScriptReplayRefusal(recordWithScript, PROJECT_FOLDER);
    // the refusal is a string that holds the parser reason.
    assert.equal(typeof refusal, "string");
    assert.ok(refusal?.includes("the command line uses $, which the replay cannot expand"));
    // a second record has the same command line and no script path.
    const recordWithoutScript = makeRecord("/Users/example/proj", "python3 move.py $(date)", null);
    // the refusal is asked for.
    const secondRefusal = getScriptReplayRefusal(recordWithoutScript, PROJECT_FOLDER);
    // there is no refusal, because the parser is never called.
    assert.equal(secondRefusal, undefined);
});

test("test_getScriptReplayRefusal_refuses_a_cd_outside_the_start_folder_of_the_run", () => {
    // Scenario: a cd that leaves the cwd of the record is refused with the resolved folder named; a cd that stays inside is not.
    // Steps:
    // the record cwd is /Users/example/proj/sub, inside the project folder /Users/example/proj.
    const startFolder = "/Users/example/proj/sub";
    // "cd inner && python3 move.py" goes to a folder inside the start folder: no refusal.
    assert.equal(getScriptReplayRefusal(makeRecord(startFolder, "cd inner && python3 move.py", "move.py"), PROJECT_FOLDER), undefined);
    // "cd . && python3 move.py" stays in the start folder: no refusal.
    assert.equal(getScriptReplayRefusal(makeRecord(startFolder, "cd . && python3 move.py", "move.py"), PROJECT_FOLDER), undefined);
    // "cd /Users/example/other && python3 move.py" goes to another folder: refused, the reason names that folder.
    const absoluteRefusal = getScriptReplayRefusal(makeRecord(startFolder, "cd /Users/example/other && python3 move.py", "move.py"), PROJECT_FOLDER);
    assert.equal(absoluteRefusal, "the script changes to /Users/example/other, outside the start folder of the run");
    // "cd .. && python3 move.py" goes to the project folder, which is outside the start folder: refused, the reason names that folder.
    const parentRefusal = getScriptReplayRefusal(makeRecord(startFolder, "cd .. && python3 move.py", "move.py"), PROJECT_FOLDER);
    assert.equal(parentRefusal, "the script changes to /Users/example/proj, outside the start folder of the run");
});

test("test_getScriptReplayRefusal_does_not_refuse_a_run_that_replays_today", () => {
    // Scenario: command lines that replay today stay unrefused.
    // Steps:
    // "mkdir o && python3 s.py a" has an unrelated earlier segment: no refusal.
    assert.equal(getScriptReplayRefusal(makeRecord("/Users/example/proj", "mkdir o && python3 s.py a", "s.py"), PROJECT_FOLDER), undefined);
    // "python3 s.py a && echo done" has a later segment: no refusal.
    assert.equal(getScriptReplayRefusal(makeRecord("/Users/example/proj", "python3 s.py a && echo done", "s.py"), PROJECT_FOLDER), undefined);
    // an exec(open(...)) line holds Python text, not a shell line: no refusal.
    assert.equal(getScriptReplayRefusal(makeRecord("/Users/example/proj", 'exec(open("x.py").read())', "x.py"), PROJECT_FOLDER), undefined);
});

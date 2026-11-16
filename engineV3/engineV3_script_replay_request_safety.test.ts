import { test } from "node:test";
import assert from "node:assert/strict";
import { Path } from "../src/structures/domain.ts";
import {
    ScriptInterpreter,
    executeScriptReplayInContainer,
    type ScriptReplayRequest,
} from "./engineV3_script_replay_container.ts";

const SAFE_PROJECT_ROOT = "/Users/example/proj";
const SAFE_STORE_FOLDER = "/jfred-test-store";

function makeSafeRequest(overrides: Partial<ScriptReplayRequest> = {}): ScriptReplayRequest {
    return {
        projectRoot: SAFE_PROJECT_ROOT,
        cwd: SAFE_PROJECT_ROOT,
        pythonImportFolder: SAFE_PROJECT_ROOT,
        interpreter: ScriptInterpreter.Bash,
        source: "echo hi\n",
        inputs: [],
        timeoutSeconds: 30,
        commandWords: ["echo", "hi"],
        environmentSettings: {},
        ...overrides,
    };
}

test("test_a_setting_name_that_is_not_a_name_throws", async () => {
    // Scenario: a setting name that starts with a digit cannot be an environment variable name.
    // Steps:
    // Build a safe request whose only setting is named `1A`.
    const request = makeSafeRequest({ environmentSettings: { "1A": "value" } });
    // Run it: the safety check throws before docker starts, and the message names the setting name.
    await assert.rejects(
        executeScriptReplayInContainer(new Path(SAFE_STORE_FOLDER), request, new AbortController().signal),
        /setting name is not a name/,
    );
});

test("test_a_setting_value_with_a_nul_character_throws", async () => {
    // Scenario: a setting value that holds a NUL character cannot be passed to a process.
    // Steps:
    // Build a safe request whose only setting has a value with a NUL character.
    const request = makeSafeRequest({ environmentSettings: { NAME: "a\u0000b" } });
    // Run it: the safety check throws before docker starts, and the message names the setting value.
    await assert.rejects(
        executeScriptReplayInContainer(new Path(SAFE_STORE_FOLDER), request, new AbortController().signal),
        /setting value holds a NUL character/,
    );
});

test("test_a_word_with_a_nul_character_throws", async () => {
    // Scenario: a command word that holds a NUL character cannot be passed to a process.
    // Steps:
    // Build a safe request whose second command word has a NUL character.
    const request = makeSafeRequest({ commandWords: ["echo", "a\u0000b"] });
    // Run it: the safety check throws before docker starts, and the message names the command word.
    await assert.rejects(
        executeScriptReplayInContainer(new Path(SAFE_STORE_FOLDER), request, new AbortController().signal),
        /command word holds a NUL character/,
    );
});

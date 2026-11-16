import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WRAPPER_PATH = join(fileURLToPath(new URL(".", import.meta.url)), "engineV3_script_replay_wrapper.py");

const PROJECT_FOLDER = "/Users/example/proj";

// Loads the wrapper as a module, points the python script path into a temp folder, then calls one wrapper function.
const PROGRAM = `
import importlib.util, json, os, sys, tempfile
wrapper_path = sys.argv[1]
function_name = sys.argv[2]
spec = importlib.util.spec_from_file_location("wrapper_under_test", wrapper_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.PYTHON_SCRIPT_PATH = os.path.join(tempfile.mkdtemp(), "__script__.py")
request = json.load(sys.stdin)
result = getattr(module, function_name)(request)
print(json.dumps({"result": result, "pythonScriptPath": module.PYTHON_SCRIPT_PATH}))
`;

interface WrapperRequest {
    interpreter: "python3" | "bash";
    source: string;
    cwd: string;
    projectRoot: string;
    pythonImportFolder: string;
    commandWords: string[];
    environmentSettings: Record<string, string>;
}

interface WrapperCallOutput {
    result: unknown;
    pythonScriptPath: string;
}

function makeRequest(overrides: Partial<WrapperRequest>): WrapperRequest {
    return {
        interpreter: "python3",
        source: "print(1)",
        cwd: PROJECT_FOLDER,
        projectRoot: PROJECT_FOLDER,
        pythonImportFolder: "/b",
        commandWords: [],
        environmentSettings: {},
        ...overrides,
    };
}

function callWrapperFunction(functionName: string, request: WrapperRequest): WrapperCallOutput {
    const hostEnvironment = { ...process.env };
    delete hostEnvironment.PYTHONPATH;
    const spawned = spawnSync("python3", ["-B", "-I", "-c", PROGRAM, WRAPPER_PATH, functionName], {
        input: JSON.stringify(request),
        encoding: "utf8",
        env: hostEnvironment,
    });
    assert.equal(spawned.status, 0, `python3 exited with ${spawned.status}: ${spawned.stderr}`);
    return JSON.parse(spawned.stdout) as WrapperCallOutput;
}

function buildEnvironment(request: WrapperRequest): Record<string, string> {
    return callWrapperFunction("build_environment", request).result as Record<string, string>;
}

test("test_build_command_adds_the_words_after_the_python_script", () => {
    // Scenario: a python run with words gets them after the script path.
    // Steps:
    // make a python request with the words "a" and "b c".
    const request = makeRequest({ interpreter: "python3", commandWords: ["a", "b c"] });
    // call build_command in the wrapper loaded as a module.
    const output = callWrapperFunction("build_command", request);
    // the command is python3, the script path, then the two words as they are.
    assert.deepEqual(output.result, ["python3", output.pythonScriptPath, "a", "b c"]);
});

test("test_build_command_adds_the_words_after_the_bash_script_name", () => {
    // Scenario: a bash run with words gets them after the arg0 word "script", so the first word is $1.
    // Steps:
    // make a bash request with source "echo hi" and the words "a" and "b c".
    const request = makeRequest({ interpreter: "bash", source: "echo hi", commandWords: ["a", "b c"] });
    // call build_command in the wrapper loaded as a module.
    const output = callWrapperFunction("build_command", request);
    // the command is bash -c, the source, the word "script", then the two words.
    assert.deepEqual(output.result, ["bash", "-c", "echo hi", "script", "a", "b c"]);
});

test("test_build_environment_gives_only_the_import_folder_when_no_settings_exist", () => {
    // Scenario: a python run with no recorded settings has PYTHONPATH equal to the import folder.
    // Steps:
    // make a python request with no settings and the import folder "/b".
    const request = makeRequest({ interpreter: "python3", environmentSettings: {}, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is exactly "/b".
    assert.equal(environment.PYTHONPATH, "/b");
});

test("test_build_environment_puts_the_recorded_python_path_before_the_import_folder", () => {
    // Scenario: a recorded PYTHONPATH setting goes in front of the import folder.
    // Steps:
    // make a python request with the setting PYTHONPATH "/a" and the import folder "/b".
    const request = makeRequest({ interpreter: "python3", environmentSettings: { PYTHONPATH: "/a" }, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is "/a:/b".
    assert.equal(environment.PYTHONPATH, "/a:/b");
});

test("test_build_environment_drops_a_leading_empty_python_path_entry", () => {
    // Scenario: a recorded PYTHONPATH with a leading empty entry loses that entry.
    // Steps:
    // make a python request with the setting PYTHONPATH ":/a" and the import folder "/b".
    const request = makeRequest({ interpreter: "python3", environmentSettings: { PYTHONPATH: ":/a" }, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is "/a:/b".
    assert.equal(environment.PYTHONPATH, "/a:/b");
});

test("test_build_environment_drops_a_trailing_empty_python_path_entry", () => {
    // Scenario: a recorded PYTHONPATH with a trailing empty entry loses that entry.
    // Steps:
    // make a python request with the setting PYTHONPATH "/a:" and the import folder "/b".
    const request = makeRequest({ interpreter: "python3", environmentSettings: { PYTHONPATH: "/a:" }, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is "/a:/b".
    assert.equal(environment.PYTHONPATH, "/a:/b");
});

test("test_build_environment_drops_a_doubled_empty_python_path_entry", () => {
    // Scenario: a recorded PYTHONPATH with an empty entry between two folders loses that entry.
    // Steps:
    // make a python request with the setting PYTHONPATH "/a::/c" and the import folder "/b".
    const request = makeRequest({ interpreter: "python3", environmentSettings: { PYTHONPATH: "/a::/c" }, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is "/a:/c:/b".
    assert.equal(environment.PYTHONPATH, "/a:/c:/b");
});

test("test_build_environment_gives_only_the_import_folder_for_an_empty_python_path", () => {
    // Scenario: a recorded PYTHONPATH that is an empty string leaves only the import folder.
    // Steps:
    // make a python request with the setting PYTHONPATH "" and the import folder "/b".
    const request = makeRequest({ interpreter: "python3", environmentSettings: { PYTHONPATH: "" }, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is exactly "/b".
    assert.equal(environment.PYTHONPATH, "/b");
});

test("test_build_environment_drops_an_empty_python_path_entry_for_a_bash_run", () => {
    // Scenario: a bash run with a recorded PYTHONPATH that has a trailing empty entry loses that entry.
    // Steps:
    // make a bash request with source "echo hi" and the setting PYTHONPATH "/a:".
    const request = makeRequest({ interpreter: "bash", source: "echo hi", environmentSettings: { PYTHONPATH: "/a:" } });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is "/a".
    assert.equal(environment.PYTHONPATH, "/a");
});

test("test_build_environment_leaves_python_path_unset_for_a_bash_run_when_no_entry_is_left", () => {
    // Scenario: a bash run with a recorded PYTHONPATH of only an empty entry gets no PYTHONPATH.
    // Steps:
    // make a bash request with source "echo hi" and the setting PYTHONPATH ":".
    const request = makeRequest({ interpreter: "bash", source: "echo hi", environmentSettings: { PYTHONPATH: ":" } });
    // call build_environment.
    const environment = buildEnvironment(request);
    // PYTHONPATH is not set.
    assert.equal(environment.PYTHONPATH, undefined);
});

test("test_build_environment_carries_a_recorded_setting_into_the_result", () => {
    // Scenario: a recorded setting appears in the environment of the run.
    // Steps:
    // make a python request with the setting NAME "v".
    const request = makeRequest({ environmentSettings: { NAME: "v" } });
    // call build_environment.
    const environment = buildEnvironment(request);
    // NAME is "v".
    assert.equal(environment.NAME, "v");
});

test("test_build_environment_does_not_set_python_path_for_a_bash_run", () => {
    // Scenario: a bash run gets no PYTHONPATH when the host has none.
    // Steps:
    // make a bash request; the helper removes PYTHONPATH from the host environment of the python process.
    const request = makeRequest({ interpreter: "bash", environmentSettings: {}, pythonImportFolder: "/b" });
    // call build_environment.
    const environment = buildEnvironment(request);
    // the result has no PYTHONPATH key.
    assert.equal("PYTHONPATH" in environment, false);
});

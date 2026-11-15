import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { checkScenarioAgainstStepStates, formatMissingExecutableLines, formatReplayCountLine, readScenarioCheckSettingsFromArguments } from "./engineV3_inverse_repos_scenario_check.ts";
import { ScriptTaskOutcomeKind, type ScriptReplaySettings, type ScriptTaskOutcome, type replayScriptTasksForProject } from "./engineV3_script_replay_run.ts";

const RECORDED_ROOT = "/recorded/run-scenario.x";
const SESSION_ID = "11111111-2222-3333-4444-555555555555";

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-scenario-check-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeCallRecord(toolUseId: string, toolName: string, recordedFile: string, second: number, extraInput: object = {}): object {
    const callContent = [{ type: "tool_use", id: toolUseId, name: toolName, input: { file_path: recordedFile, ...extraInput }, caller: { type: "direct" } }];
    return { type: "assistant", uuid: `call-${toolUseId}`, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
}

function makeResultRecord(toolUseId: string, toolUseResult: object, second: number): object {
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    return { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), cwd: RECORDED_ROOT, message: { role: "user", content: resultContent }, toolUseResult };
}

function makeWriteRows(toolUseId: string, relativePath: string, content: string, second: number): object[] {
    const recordedFile = `${RECORDED_ROOT}/${relativePath}`;
    const toolUseResult = { type: "create", filePath: recordedFile, content, structuredPatch: [], originalFile: null, userModified: false };
    return [makeCallRecord(toolUseId, "Write", recordedFile, second, { content }), makeResultRecord(toolUseId, toolUseResult, second)];
}

function makeEditRows(toolUseId: string, relativePath: string, oldString: string, newString: string, originalFile: string, second: number): object[] {
    const recordedFile = `${RECORDED_ROOT}/${relativePath}`;
    const toolUseResult = { filePath: recordedFile, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false, originalFile };
    return [makeCallRecord(toolUseId, "Edit", recordedFile, second), makeResultRecord(toolUseId, toolUseResult, second)];
}

type FakeScenario = { scenarioFolder: Path; fileHistoryFolder: Path; workFolder: Path };

// Each entry of stepFiles is the project files of one step, as relative path to text.
function makeScenario(t: TestContext, stepFiles: Record<string, string>[], records: object[]): FakeScenario {
    const rootFolder = makeTempFolder(t);
    const scenarioFolder = join(rootFolder, "fake-scenario");
    const fileHistoryFolder = join(rootFolder, "file-history");
    const workFolder = join(rootFolder, "work");
    mkdirSync(join(scenarioFolder, ".step_states"), { recursive: true });
    mkdirSync(fileHistoryFolder);
    mkdirSync(workFolder);
    writeFileSync(join(scenarioFolder, `${SESSION_ID}.jsonl`), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    for (const [index, files] of stepFiles.entries()) {
        const stepFolder = join(scenarioFolder, ".step_states", `step-${String(index + 1).padStart(3, "0")}`);
        mkdirSync(stepFolder);
        writeFileSync(join(stepFolder, "manifest.json"), "{}\n");
        for (const [relativePath, text] of Object.entries(files)) {
            mkdirSync(dirname(join(stepFolder, relativePath)), { recursive: true });
            writeFileSync(join(stepFolder, relativePath), text);
        }
    }
    return { scenarioFolder: new Path(scenarioFolder), fileHistoryFolder: new Path(fileHistoryFolder), workFolder: new Path(workFolder) };
}

function runCheck(scenario: FakeScenario, isReplayScriptsOn?: boolean, replayScriptTasks?: typeof replayScriptTasksForProject) {
    return checkScenarioAgainstStepStates(scenario.scenarioFolder, scenario.fileHistoryFolder, scenario.workFolder, isReplayScriptsOn, replayScriptTasks);
}

function makeOutcome(taskId: string, outcome: ScriptTaskOutcomeKind, missingExecutable: string | null): ScriptTaskOutcome {
    return { taskId, outcome, reason: null, missingExecutable, exitCode: null, timedOut: false, stdout: "", stderr: "", files: [] };
}

function formatExpectedMissingLine(name: string): string {
    return `script replay: missing executable or Python module ${name} in reveng-sandbox:1: add it to sandbox-image/Dockerfile`;
}

function listFilesRecursively(folder: string): string[] {
    return readdirSync(folder, { recursive: true }).map(String).sort();
}

const WRITE_THEN_EDIT_RECORDS = [...makeWriteRows("toolu_w", "a.py", "one\n", 10), ...makeEditRows("toolu_e", "a.py", "one", "two", "one\n", 20)];

test("test_every_step_text_is_found_for_a_file_written_then_edited", async (t) => {
    // Scenario: a file written in step 1 and edited in step 2 has every step text recovered.
    // Step 1 holds "one", steps 2 and 3 hold "two"; the transcript has the Write and the Edit.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }, { "a.py": "two\n" }, { "a.py": "two\n" }], WRITE_THEN_EDIT_RECORDS);
    // Run the check.
    const result = await runCheck(scenario);
    // All three step texts are found and nothing is missed.
    assert.equal(result.foundStepTextCount, 3);
    assert.deepEqual(result.missedStepTexts, []);
    assert.equal(result.scenarioName, "fake-scenario");
});

test("test_a_step_text_no_event_explains_is_reported_as_a_miss", async (t) => {
    // Scenario: step 2 holds a text that never appears in the transcript.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }, { "a.py": "mystery\n" }, { "a.py": "two\n" }], WRITE_THEN_EDIT_RECORDS);
    // Run the check.
    const result = await runCheck(scenario);
    // Only the step 2 text is missed, with its step name and path.
    assert.equal(result.foundStepTextCount, 2);
    assert.deepEqual(result.missedStepTexts, [{ relativePath: "a.py", stepName: "step-002", isFileAbsentInStep: false }]);
});

test("test_a_file_gone_in_a_later_step_finds_its_text_and_its_absent_expectation", async (t) => {
    // Scenario: a.py exists in step 1 (made by a Write) and is gone in step 2; keep.py stays.
    const scenario = makeScenario(t, [{ "a.py": "one\n", "keep.py": "k\n" }, { "keep.py": "k\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    // Run the check.
    const result = await runCheck(scenario);
    // The step 1 text comes from the Write and the step 2 absent expectation from the disk-now state.
    assert.deepEqual(result.missedStepTexts, []);
    assert.equal(result.foundStepTextCount, 4);
});

test("test_a_file_never_present_in_a_step_is_reported_as_absent_when_missed", async (t) => {
    // Scenario: a.py is absent in step 1 but present in step 2 and on disk now, with no event for it.
    const scenario = makeScenario(t, [{ "keep.py": "k\n" }, { "keep.py": "k\n", "a.py": "late\n" }], makeWriteRows("toolu_w", "keep.py", "k\n", 10));
    // Run the check.
    const result = await runCheck(scenario);
    // The step 1 absent expectation is missed because disk-now is the only state and it holds text.
    assert.deepEqual(result.missedStepTexts, [{ relativePath: "a.py", stepName: "step-001", isFileAbsentInStep: true }]);
});

test("test_file_count_and_step_text_count_are_files_times_steps", async (t) => {
    // Scenario: two files seen over two steps count as 2 files and 4 step texts, with the commit and unknown counts summed.
    const scenario = makeScenario(t, [{ "a.py": "one\n", "keep.py": "k\n" }, { "keep.py": "k\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    // Run the check.
    const result = await runCheck(scenario);
    // The counts match the fixture.
    assert.equal(result.fileCount, 2);
    assert.equal(result.stepTextCount, 4);
    assert.equal(result.unknownStateCount, 0);
    // a.py: disk-now absent, the Write text, absent before the Write; keep.py: disk-now.
    assert.equal(result.commitCount, 4);
});

test("test_the_project_copy_is_made_in_the_work_folder_and_the_scenario_folder_is_not_written", async (t) => {
    // Scenario: the last step becomes <work>/project and nothing is written into the scenario folder.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }, { "a.py": "two\n", "sub/b.py": "b\n" }], WRITE_THEN_EDIT_RECORDS);
    const listingBefore = listFilesRecursively(scenario.scenarioFolder.toString());
    // Run the check.
    await runCheck(scenario);
    // The work folder holds the files of the last step and not the manifest.
    const projectFolder = join(scenario.workFolder.toString(), "project");
    assert.equal(readFileSync(join(projectFolder, "a.py"), "utf8"), "two\n");
    assert.equal(readFileSync(join(projectFolder, "sub", "b.py"), "utf8"), "b\n");
    assert.equal(existsSync(join(projectFolder, "manifest.json")), false);
    // The scenario folder listing is the same as before.
    assert.deepEqual(listFilesRecursively(scenario.scenarioFolder.toString()), listingBefore);
});

test("test_a_git_folder_of_the_scenario_is_copied_into_the_project_copy", async (t) => {
    // Scenario: a scenario folder that is a git repo gives the project copy the same history.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    const scenarioFolder = scenario.scenarioFolder.toString();
    writeFileSync(join(scenarioFolder, "a.py"), "one\n");
    const gitArguments = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"];
    execFileSync("git", [...gitArguments, "init", "-q"], { cwd: scenarioFolder, stdio: "pipe" });
    execFileSync("git", [...gitArguments, "add", "a.py"], { cwd: scenarioFolder, stdio: "pipe" });
    execFileSync("git", [...gitArguments, "commit", "-q", "-m", "first"], { cwd: scenarioFolder, stdio: "pipe" });
    const scenarioHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: scenarioFolder, encoding: "utf8" });
    // Run the check.
    await runCheck(scenario);
    // The project copy has the same HEAD commit.
    const projectHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(scenario.workFolder.toString(), "project"), encoding: "utf8" });
    assert.equal(projectHead, scenarioHead);
});

test("test_the_project_root_is_the_outermost_cwd_of_all_transcripts", async (t) => {
    // Scenario: one transcript ran in the project root and another ran in its tests subfolder; the nested transcript is listed first.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }, { "a.py": "two\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    const nestedRecord = { type: "user", uuid: "nested-1", timestamp: makeInstant(5).toISOString(), cwd: `${RECORDED_ROOT}/tests`, message: { role: "user", content: "hello" } };
    writeFileSync(join(scenario.scenarioFolder.toString(), "00000000-0000-0000-0000-000000000000.jsonl"), JSON.stringify(nestedRecord) + "\n");
    // Run the check.
    const result = await runCheck(scenario);
    // The Write at the project root explains the step 1 text and the disk-now state holds the step 2 text, so nothing is missed.
    assert.deepEqual(result.missedStepTexts, []);
    assert.equal(result.foundStepTextCount, 2);
});

test("test_a_scenario_with_no_step_folders_throws_an_error_naming_it", async (t) => {
    // Scenario: the .step_states folder is empty.
    const scenario = makeScenario(t, [], []);
    // Running the check rejects with an error that names the scenario.
    await assert.rejects(() => runCheck(scenario), /fake-scenario/);
});

test("test_the_arguments_give_the_folders_and_the_only_list", () => {
    // Scenario: the parser reads both folders and every --only name.
    const settings = readScenarioCheckSettingsFromArguments(["--scenarios", "/s", "--only", "s1", "--file-history", "/f", "--only", "s4"]);
    // The folders and the names are returned.
    assert.equal(settings.scenariosFolder.toString(), "/s");
    assert.equal(settings.fileHistoryFolder.toString(), "/f");
    assert.deepEqual(settings.onlyScenarioNames, ["s1", "s4"]);
});

test("test_the_arguments_give_an_empty_only_list_when_none_is_given", () => {
    // Scenario: without --only the list is empty, which means every scenario.
    const settings = readScenarioCheckSettingsFromArguments(["--scenarios", "/s", "--file-history", "/f"]);
    assert.deepEqual(settings.onlyScenarioNames, []);
});

test("test_a_missing_required_argument_throws", () => {
    // Scenario: --file-history is missing.
    assert.throws(() => readScenarioCheckSettingsFromArguments(["--scenarios", "/s"]), /usage/);
});

function makeFakeReplay(outcomes: ScriptTaskOutcome[]) {
    const calls: { settings: ScriptReplaySettings; toInstant: Date }[] = [];
    const replayScriptTasks: typeof replayScriptTasksForProject = async (settings, toInstant) => {
        calls.push({ settings, toInstant });
        return outcomes;
    };
    return { calls, replayScriptTasks };
}

test("test_flag_replay_scripts_is_read_from_the_arguments", () => {
    // Scenario: the flag has no value, can sit between other flags, and is not mistaken for a scenario name.
    const settingsWithFlag = readScenarioCheckSettingsFromArguments(["--scenarios", "/s", "--replay-scripts", "--only", "s1", "--file-history", "/f"]);
    // The flag is on and the other settings are still read.
    assert.equal(settingsWithFlag.isReplayScriptsOn, true);
    assert.equal(settingsWithFlag.scenariosFolder.toString(), "/s");
    assert.equal(settingsWithFlag.fileHistoryFolder.toString(), "/f");
    assert.deepEqual(settingsWithFlag.onlyScenarioNames, ["s1"]);
    // Without the flag it is off.
    const settingsWithoutFlag = readScenarioCheckSettingsFromArguments(["--scenarios", "/s", "--file-history", "/f"]);
    assert.equal(settingsWithoutFlag.isReplayScriptsOn, false);
});

test("test_check_without_the_flag_runs_no_replay", async (t) => {
    // Scenario: the check runs with the flag off and a fake replay that counts its calls.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    const fakeReplay = makeFakeReplay([makeOutcome("task-1", ScriptTaskOutcomeKind.Replayed, null)]);
    // Run the check with the flag off.
    const result = await runCheck(scenario, false, fakeReplay.replayScriptTasks);
    // The fake was never called and the result holds no replay outcomes.
    assert.equal(fakeReplay.calls.length, 0);
    assert.deepEqual(result.replayOutcomes, []);
});

test("test_check_with_the_flag_calls_the_replay_once", async (t) => {
    // Scenario: the check runs with the flag on and a fake replay that records its arguments and returns one outcome.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    const outcomes = [makeOutcome("task-1", ScriptTaskOutcomeKind.Replayed, null)];
    const fakeReplay = makeFakeReplay(outcomes);
    // Run the check with the flag on.
    const result = await runCheck(scenario, true, fakeReplay.replayScriptTasks);
    // The fake was called exactly once.
    assert.equal(fakeReplay.calls.length, 1);
    // It got the project copy, the recorded root, the scenario folder, the file-history folder and the store folder of the work folder.
    const settings = fakeReplay.calls[0]!.settings;
    assert.equal(settings.projectFolder.toString(), join(scenario.workFolder.toString(), "project"));
    assert.equal(settings.recordedProjectFolder.toString(), RECORDED_ROOT);
    assert.deepEqual(settings.jsonlsFolders.map(String), [scenario.scenarioFolder.toString()]);
    assert.deepEqual(settings.snapshotFolders.map(String), [scenario.fileHistoryFolder.toString()]);
    assert.equal(settings.storeFolder.toString(), join(scenario.workFolder.toString(), "store"));
    assert.equal(settings.projectFiles.length, 1);
    // It got the fixed disk-now instant, and the result holds the outcomes it returned.
    assert.equal(fakeReplay.calls[0]!.toInstant.toISOString(), "2099-01-01T00:00:00.000Z");
    assert.deepEqual(result.replayOutcomes, outcomes);
});

test("test_existing_scenario_results_are_unchanged_without_the_flag", async (t) => {
    // Scenario: two identical scenarios, one checked with the default flag and one with the flag on and a replay that returns nothing.
    const stepFiles = [{ "a.py": "one\n" }, { "a.py": "mystery\n" }, { "a.py": "two\n" }];
    const scenarioWithoutFlag = makeScenario(t, stepFiles, WRITE_THEN_EDIT_RECORDS);
    const scenarioWithFlag = makeScenario(t, stepFiles, WRITE_THEN_EDIT_RECORDS);
    // Run both checks.
    const resultWithoutFlag = await runCheck(scenarioWithoutFlag);
    const resultWithFlag = await runCheck(scenarioWithFlag, true, makeFakeReplay([]).replayScriptTasks);
    // The result without the flag is the known one, with no replay outcomes.
    assert.equal(resultWithoutFlag.scenarioName, "fake-scenario");
    assert.equal(resultWithoutFlag.fileCount, 1);
    assert.equal(resultWithoutFlag.stepTextCount, 3);
    assert.equal(resultWithoutFlag.foundStepTextCount, 2);
    assert.deepEqual(resultWithoutFlag.missedStepTexts, [{ relativePath: "a.py", stepName: "step-002", isFileAbsentInStep: false }]);
    assert.deepEqual(resultWithoutFlag.replayOutcomes, []);
    // A replay that fills nothing leaves the whole result the same.
    assert.deepEqual(resultWithFlag, resultWithoutFlag);
});

test("test_check_with_the_flag_prints_each_missing_executable_once", async (t) => {
    // Scenario: the fake replay returns two outcomes that miss the same program and one outcome that misses another.
    const scenario = makeScenario(t, [{ "a.py": "one\n" }], makeWriteRows("toolu_w", "a.py", "one\n", 10));
    const fakeReplay = makeFakeReplay([
        makeOutcome("task-1", ScriptTaskOutcomeKind.Failed, "nosuchtool_a"),
        makeOutcome("task-2", ScriptTaskOutcomeKind.Failed, "nosuchtool_a"),
        makeOutcome("task-3", ScriptTaskOutcomeKind.Failed, "nosuchtool_b"),
    ]);
    // Run the check with the flag on and format the missing-executable lines of its outcomes.
    const result = await runCheck(scenario, true, fakeReplay.replayScriptTasks);
    const lines = formatMissingExecutableLines(result.replayOutcomes);
    // Two lines, one per distinct name, in first-seen order.
    assert.deepEqual(lines, [formatExpectedMissingLine("nosuchtool_a"), formatExpectedMissingLine("nosuchtool_b")]);
});

test("test_replay_count_line_counts_each_outcome_kind", () => {
    // Scenario: four outcomes: one replayed, two failed, one refused.
    const outcomes = [
        makeOutcome("task-1", ScriptTaskOutcomeKind.Replayed, null),
        makeOutcome("task-2", ScriptTaskOutcomeKind.Failed, null),
        makeOutcome("task-3", ScriptTaskOutcomeKind.Failed, "nosuchtool_a"),
        makeOutcome("task-4", ScriptTaskOutcomeKind.Refused, null),
    ];
    // The count line holds the three counts.
    assert.equal(formatReplayCountLine(outcomes), "replayed tasks 1, failed 2, refused 1");
});

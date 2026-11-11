import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOCKER_SCRIPT_PATH = join(import.meta.dirname, "run_replay_in_docker.sh");
// The order in which the script runs its setup stages.
const SETUP_STAGE_NAMES = ["state-folder cwd scan", "lockfile collection", "docker build", "mounts", "container start", "stand-ins", "engine start", "copy-out", "disk check"];

function readDockerScriptLines(): string[] {
    return readFileSync(DOCKER_SCRIPT_PATH, "utf8").split("\n");
}

function findFirstLineIndex(scriptLines: string[], wantedLine: string): number {
    for (const [lineIndex, scriptLine] of scriptLines.entries()) {
        if (scriptLine.trim() === wantedLine) {
            return lineIndex;
        }
    }
    return -1;
}

function findStageStartLineIndex(scriptLines: string[], stageName: string): number {
    return findFirstLineIndex(scriptLines, `printSetupStageStart "${stageName}"`);
}

function findStageDoneLineIndex(scriptLines: string[], stageName: string): number {
    return findFirstLineIndex(scriptLines, `printSetupStageDone "${stageName}"`);
}

// The two print functions, cut out of the script so they can run on their own.
function readSetupStageFunctionsText(): string {
    const scriptText = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const functionsStart = scriptText.indexOf("printSetupStageStart() {");
    const functionsEnd = scriptText.indexOf("\n}\n", scriptText.indexOf("printSetupStageDone() {")) + 3;
    assert.notEqual(functionsStart, -1, "the script defines printSetupStageStart");
    return scriptText.slice(functionsStart, functionsEnd);
}

test("test_run_replay_in_docker_passes_the_sh_syntax_check", () => {
    // Scenario: `sh -n` reads the whole script without running it and finds no syntax error.
    execFileSync("sh", ["-n", DOCKER_SCRIPT_PATH]);
});

test("test_every_setup_stage_has_a_start_line_and_a_done_line", () => {
    // Scenario: each stage name has one start print call and one done print call in the script.
    const scriptLines = readDockerScriptLines();
    for (const stageName of SETUP_STAGE_NAMES) {
        assert.notEqual(findStageStartLineIndex(scriptLines, stageName), -1, `start line for ${stageName}`);
        assert.notEqual(findStageDoneLineIndex(scriptLines, stageName), -1, `done line for ${stageName}`);
    }
});

test("test_every_setup_stage_starts_before_it_is_done", () => {
    // Scenario: the start print call of each stage comes before its done print call.
    const scriptLines = readDockerScriptLines();
    for (const stageName of SETUP_STAGE_NAMES) {
        const startLineIndex = findStageStartLineIndex(scriptLines, stageName);
        const doneLineIndex = findStageDoneLineIndex(scriptLines, stageName);
        assert.ok(startLineIndex < doneLineIndex, `${stageName}: start line ${startLineIndex} is before done line ${doneLineIndex}`);
    }
});

test("test_setup_stages_run_in_the_listed_order", () => {
    // Scenario: each stage's done line comes before the next stage's start line.
    const scriptLines = readDockerScriptLines();
    for (let stageIndex = 1; stageIndex < SETUP_STAGE_NAMES.length; stageIndex++) {
        const earlierStageName = SETUP_STAGE_NAMES[stageIndex - 1] as string;
        const laterStageName = SETUP_STAGE_NAMES[stageIndex] as string;
        const earlierDoneLineIndex = findStageDoneLineIndex(scriptLines, earlierStageName);
        const laterStartLineIndex = findStageStartLineIndex(scriptLines, laterStageName);
        assert.ok(earlierDoneLineIndex < laterStartLineIndex, `${earlierStageName} is done before ${laterStageName} starts`);
    }
});

test("test_setup_stage_lines_print_the_iso_time_and_the_seconds", () => {
    // Scenario: the two print functions run in sh and print "<ISO time> setup: <stage>" and "<ISO time> setup: <stage> done in <N>s".
    const output = execFileSync("sh", ["-eu", "-c", `${readSetupStageFunctionsText()}\nprintSetupStageStart "example stage"\nprintSetupStageDone "example stage"\n`], { encoding: "utf8" });
    const outputLines = output.trim().split("\n");
    assert.equal(outputLines.length, 2);
    assert.match(outputLines[0] as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z setup: example stage$/);
    assert.match(outputLines[1] as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z setup: example stage done in \d+s$/);
});

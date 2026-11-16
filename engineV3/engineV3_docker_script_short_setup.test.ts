import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHORT_SCRIPT_PATH = join(import.meta.dirname, "run_engineV3_in_docker.sh");

const REPO_FOLDER_CHOWN_LINE = 'docker exec "$NAME" chown replay "$REPO_FOLDER"';
const VAR_FOLDERS_MKDIR_LINE = 'docker exec "$NAME" mkdir -p /var/folders';
const VAR_FOLDERS_CHOWN_LINE = 'docker exec "$NAME" chown replay /var/folders';
const MEMORY_IF_LINE = 'if [ -d "$JSONL_FOLDER/memory" ]; then';
const MEMORY_CHOWN_LINE = 'docker exec "$NAME" chown -R replay "$JSONL_FOLDER/memory"';
const JSONL_COPY_LINE_START = 'docker cp "$JSONL_FOLDER"';
const ENGINE_START_LINE_START = 'docker exec -u replay "$NAME" tsx /input/jfred/engineV3/engineV3_replay.ts';

function readShortScriptLines(): string[] {
    return readFileSync(SHORT_SCRIPT_PATH, "utf8").split("\n");
}

function findFirstLineIndex(scriptLines: string[], wantedLine: string): number {
    return scriptLines.findIndex((scriptLine) => scriptLine.trim() === wantedLine);
}

function findFirstLineStartingWithIndex(scriptLines: string[], wantedStart: string): number {
    return scriptLines.findIndex((scriptLine) => scriptLine.trim().startsWith(wantedStart));
}

test("test_the_short_script_makes_var_folders_and_gives_it_to_the_replay_user", () => {
    // Scenario: the short script makes /var/folders in the container and gives it to the replay user.
    // Step: read the lines of the short script.
    const scriptLines = readShortScriptLines();
    // Step: find the line that makes the /var/folders folder.
    const mkdirIndex = findFirstLineIndex(scriptLines, VAR_FOLDERS_MKDIR_LINE);
    // Step: find the line that gives the /var/folders folder to the replay user.
    const chownIndex = findFirstLineIndex(scriptLines, VAR_FOLDERS_CHOWN_LINE);
    // Step: check that both lines exist.
    assert.notEqual(mkdirIndex, -1, "the script holds the var/folders mkdir line");
    assert.notEqual(chownIndex, -1, "the script holds the var/folders chown line");
});

test("test_the_var_folders_lines_come_after_the_repo_folder_chown_and_before_the_engine_starts", () => {
    // Scenario: the var/folders lines run after the repo folder is given to the replay user and before the engine starts.
    // Step: read the lines of the short script.
    const scriptLines = readShortScriptLines();
    // Step: find the repo folder chown line, the two var/folders lines, and the engine start line.
    const repoFolderChownIndex = findFirstLineIndex(scriptLines, REPO_FOLDER_CHOWN_LINE);
    const mkdirIndex = findFirstLineIndex(scriptLines, VAR_FOLDERS_MKDIR_LINE);
    const chownIndex = findFirstLineIndex(scriptLines, VAR_FOLDERS_CHOWN_LINE);
    const engineStartIndex = findFirstLineStartingWithIndex(scriptLines, ENGINE_START_LINE_START);
    // Step: check that every line exists.
    assert.notEqual(repoFolderChownIndex, -1, "the script holds the repo folder chown line");
    assert.notEqual(mkdirIndex, -1, "the script holds the var/folders mkdir line");
    assert.notEqual(chownIndex, -1, "the script holds the var/folders chown line");
    assert.notEqual(engineStartIndex, -1, "the script holds the engine start line");
    // Step: check the order of the lines.
    assert.ok(repoFolderChownIndex < mkdirIndex, "repo folder chown comes before the var/folders mkdir");
    assert.ok(mkdirIndex < chownIndex, "var/folders mkdir comes before the var/folders chown");
    assert.ok(chownIndex < engineStartIndex, "var/folders chown comes before the engine start");
});

test("test_the_short_script_gives_the_memory_folder_of_the_logs_to_the_replay_user", () => {
    // Scenario: the short script gives the memory folder of the logs to the replay user, after the logs are copied and before the engine starts.
    // Step: read the lines of the short script.
    const scriptLines = readShortScriptLines();
    // Step: find the log copy line, the memory check line, the memory chown line, and the engine start line.
    const jsonlCopyIndex = findFirstLineStartingWithIndex(scriptLines, JSONL_COPY_LINE_START);
    const memoryIfIndex = findFirstLineIndex(scriptLines, MEMORY_IF_LINE);
    const memoryChownIndex = findFirstLineIndex(scriptLines, MEMORY_CHOWN_LINE);
    const engineStartIndex = findFirstLineStartingWithIndex(scriptLines, ENGINE_START_LINE_START);
    // Step: check that every line exists.
    assert.notEqual(jsonlCopyIndex, -1, "the script holds the log copy line");
    assert.notEqual(memoryIfIndex, -1, "the script holds the memory check line");
    assert.notEqual(memoryChownIndex, -1, "the script holds the memory chown line");
    assert.notEqual(engineStartIndex, -1, "the script holds the engine start line");
    // Step: check the order of the lines.
    assert.ok(jsonlCopyIndex < memoryIfIndex, "log copy comes before the memory check");
    assert.ok(memoryIfIndex < memoryChownIndex, "memory check comes before the memory chown");
    assert.ok(memoryChownIndex < engineStartIndex, "memory chown comes before the engine start");
});

test("test_the_short_script_passes_the_sh_syntax_check", () => {
    // Scenario: the short script has no shell syntax errors.
    // Step: run sh -n on the script. It throws if the syntax is wrong.
    execFileSync("sh", ["-n", SHORT_SCRIPT_PATH]);
});

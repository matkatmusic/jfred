// The --step-all flag of the step program: usage errors, one results line per file plus the summary, and a restart on the same store.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { Path } from "../src/structures/domain.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { StepAllRecordKind, StepAllVerdict } from "../src/structures/vocabulary.ts";
import { makeEditRows, makeWriteCreateRows, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

const JFRED_FOLDER = join(import.meta.dirname, "..");
const PROGRAM_FILE = "engineV3/engineV3_inverse_repos_for_project.ts";
const PROGRAM_TIMEOUT_MILLISECONDS = 110000;
const USAGE_PATTERN = /usage:/;

type ResultRecord = Record<string, any>;

function makeStoreFolderInsideCacheFolder(t: TestContext): Path {
    const storeFolder = join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-" + randomUUID());
    mkdirSync(storeFolder, { recursive: true });
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    return new Path(storeFolder);
}

// a.txt: a Write and an Edit. b.txt: a Write and an Edit.
function writeTwoPlainFilesProject(t: TestContext): ProjectWithFiles {
    return writeProjectFiles(t, new Map([["a.txt", "a1\n"], ["b.txt", "b1\n"]]), (projectFolder, filePathByFileName) => {
        const aPath = filePathByFileName.get("a.txt")!;
        const bPath = filePathByFileName.get("b.txt")!;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_a0", aPath, "a0\n", 10),
            ...makeEditRows(projectFolder, "toolu_a1", aPath, "a0", "a1", "a0\n", 20),
            ...makeWriteCreateRows(projectFolder, "toolu_b0", bPath, "b0\n", 12),
            ...makeEditRows(projectFolder, "toolu_b1", bPath, "b0", "b1", "b0\n", 22),
        ];
    });
}

function spawnStepAllProgram(project: ProjectWithFiles, storeFolder: Path, extraArguments: string[]): SpawnSyncReturns<string> {
    const programArguments = [
        "--import", "tsx", PROGRAM_FILE,
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", storeFolder.toString(),
        ...extraArguments,
    ];
    return spawnSync(process.execPath, programArguments, { cwd: JFRED_FOLDER, encoding: "utf8", timeout: PROGRAM_TIMEOUT_MILLISECONDS });
}

function readJsonLines(text: string): ResultRecord[] {
    return text.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as ResultRecord);
}

test("test_step_all_with_step_throws_the_usage_text", (t) => {
    // Scenario: --step-all and --step are both given.
    const project = writeTwoPlainFilesProject(t);
    const resultsFile = join(project.rootFolder, "results.jsonl");
    const spawned = spawnStepAllProgram(project, makeStoreFolderInsideCacheFolder(t), ["--step-all", "--results", resultsFile, "--step", "a.txt"]);
    // The program exits with an error that holds the usage text.
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_step_all_without_results_throws_the_usage_text", (t) => {
    // Scenario: --step-all is given with no --results.
    const project = writeTwoPlainFilesProject(t);
    const spawned = spawnStepAllProgram(project, makeStoreFolderInsideCacheFolder(t), ["--step-all"]);
    // The program exits with an error that holds the usage text.
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_step_all_with_from_now_throws_the_usage_text", (t) => {
    // Scenario: --step-all and --from-now are both given.
    const project = writeTwoPlainFilesProject(t);
    const resultsFile = join(project.rootFolder, "results.jsonl");
    const spawned = spawnStepAllProgram(project, makeStoreFolderInsideCacheFolder(t), ["--step-all", "--results", resultsFile, "--from-now"]);
    // The program exits with an error that holds the usage text.
    assert.notEqual(spawned.status, 0);
    assert.match(spawned.stderr, USAGE_PATTERN);
});

test("test_step_all_walks_every_file_and_writes_one_line_per_file_plus_the_summary", (t) => {
    // Scenario: a project with two files that have Edit rows.
    const project = writeTwoPlainFilesProject(t);
    const resultsFile = join(project.rootFolder, "results.jsonl");
    // The program runs with --step-all and --results.
    const spawned = spawnStepAllProgram(project, makeStoreFolderInsideCacheFolder(t), ["--step-all", "--results", resultsFile]);
    // The program exits with 0.
    assert.equal(spawned.status, 0, spawned.stderr);
    // The results file holds 2 file lines with the verdict end and 1 summary line with end 2.
    const resultRecords = readJsonLines(readFileSync(resultsFile, "utf8"));
    assert.equal(resultRecords.length, 3);
    assert.deepEqual(resultRecords.slice(0, 2).map((record) => [record.kind, record.verdict]), [[StepAllRecordKind.File, StepAllVerdict.End], [StepAllRecordKind.File, StepAllVerdict.End]]);
    assert.equal(resultRecords[2]!.kind, StepAllRecordKind.Summary);
    assert.equal(resultRecords[2]!.end, 2);
    // The standard output holds the same 3 lines.
    assert.deepEqual(readJsonLines(spawned.stdout), resultRecords);
});

test("test_step_all_run_twice_on_the_same_store_gives_the_same_verdicts", (t) => {
    // Scenario: the program runs twice on one store (a restart).
    const project = writeTwoPlainFilesProject(t);
    const storeFolder = makeStoreFolderInsideCacheFolder(t);
    const firstResultsFile = join(project.rootFolder, "first.jsonl");
    const secondResultsFile = join(project.rootFolder, "second.jsonl");
    const firstSpawned = spawnStepAllProgram(project, storeFolder, ["--step-all", "--results", firstResultsFile]);
    assert.equal(firstSpawned.status, 0, firstSpawned.stderr);
    const secondSpawned = spawnStepAllProgram(project, storeFolder, ["--step-all", "--results", secondResultsFile]);
    assert.equal(secondSpawned.status, 0, secondSpawned.stderr);
    // Every verdict of the second run is end, and each file has the same stepsBackward as in the first run.
    const firstFileRecords = readJsonLines(readFileSync(firstResultsFile, "utf8")).filter((record) => record.kind === StepAllRecordKind.File);
    const secondFileRecords = readJsonLines(readFileSync(secondResultsFile, "utf8")).filter((record) => record.kind === StepAllRecordKind.File);
    assert.equal(secondFileRecords.length, 2);
    assert.deepEqual(secondFileRecords.map((record) => record.verdict), [StepAllVerdict.End, StepAllVerdict.End]);
    assert.deepEqual(secondFileRecords.map((record) => [record.file, record.stepsBackward]), firstFileRecords.map((record) => [record.file, record.stepsBackward]));
});

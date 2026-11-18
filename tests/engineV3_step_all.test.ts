// The --step-all walk: every project file is stepped to its end with no key presses, then walked back with b.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { INVERSE_REPOS_CACHE_FOLDER } from "../src/viewer_api_layer1_inverse_repos.ts";
import { StepAllReplayKind, StepAllVerdict } from "../src/structures/vocabulary.ts";
import { FileEventType } from "../engineV3/engineV3_replay_reverse_events.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { walkAllFilesInStepMode } from "../engineV3/engineV3_step_all.ts";
import { checkBackwardWalk } from "../engineV3/engineV3_step_all_backward.ts";
import { makeBashRows, makeEditRows, makeWriteCreateRows, writeProjectFiles, type ProjectWithFiles } from "./engineV3_step_test_projects.ts";

type PrintedRecord = Record<string, any>;

function makeStoreFolderInsideCacheFolder(t: TestContext): Path {
    const storeFolder = join(INVERSE_REPOS_CACHE_FOLDER, "jfred-test-" + randomUUID());
    mkdirSync(storeFolder, { recursive: true });
    t.after(() => rmSync(storeFolder, { recursive: true, force: true }));
    return new Path(storeFolder);
}

function captureOutput(t: TestContext): string[] {
    const printedTexts: string[] = [];
    t.mock.method(console, "log", (printedText: string) => {
        printedTexts.push(printedText);
    });
    t.mock.method(process.stderr, "write", () => true);
    return printedTexts;
}

function listProjectFiles(project: ProjectWithFiles): ProjectFile[] {
    return [...project.fileByName.values()].map((file) => ({ file, transcriptFile: file }));
}

function readResultRecords(resultsFile: Path): PrintedRecord[] {
    return readFileSync(resultsFile.toString(), "utf8").split("\n").filter((resultLine) => resultLine !== "").map((resultLine) => JSON.parse(resultLine) as PrintedRecord);
}

async function walkProject(project: ProjectWithFiles, storeFolder: Path): Promise<{ summary: PrintedRecord; resultsFile: Path }> {
    const resultsFile = new Path(join(project.rootFolder, "results.jsonl"));
    const summary = await walkAllFilesInStepMode({ projectFolder: project.projectFolder, jsonlsFolders: [project.jsonlsFolder], fileHistoryFolders: [project.snapshotFolder], storeFolder, projectFiles: listProjectFiles(project), transcriptsToParse: [project.jsonlsFolder], resultsFile });
    return { summary: summary as unknown as PrintedRecord, resultsFile };
}

// a.txt: a Write and two Edits. b.txt: a Write and an Edit.
function writeTwoPlainFilesProject(t: TestContext): ProjectWithFiles {
    return writeProjectFiles(t, new Map([["a.txt", "a2\n"], ["b.txt", "b1\n"]]), (projectFolder, filePathByFileName) => {
        const aPath = filePathByFileName.get("a.txt")!;
        const bPath = filePathByFileName.get("b.txt")!;
        return [
            ...makeWriteCreateRows(projectFolder, "toolu_a0", aPath, "a0\n", 10),
            ...makeEditRows(projectFolder, "toolu_a1", aPath, "a0", "a1", "a0\n", 20),
            ...makeEditRows(projectFolder, "toolu_a2", aPath, "a1", "a2", "a1\n", 30),
            ...makeWriteCreateRows(projectFolder, "toolu_b0", bPath, "b0\n", 12),
            ...makeEditRows(projectFolder, "toolu_b1", bPath, "b0", "b1", "b0\n", 22),
        ];
    });
}

// s.txt: its oldest event is a script that may write it, so the stop gap reaches the start of the history.
function writeScriptOldestProject(t: TestContext, otherFileRows: boolean): ProjectWithFiles {
    const diskTextByFileName = new Map([["s.txt", "v1\n"]]);
    if (otherFileRows) {
        diskTextByFileName.set("e.txt", "abc\n");
    }
    return writeProjectFiles(t, diskTextByFileName, (projectFolder, filePathByFileName) => {
        const rows = makeBashRows(projectFolder, "toolu_s1", `printf 'v1\\n' > ${filePathByFileName.get("s.txt")!}`, 20);
        if (otherFileRows) {
            rows.push(...makeEditRows(projectFolder, "toolu_q", filePathByFileName.get("e.txt")!, "q", "Z", null, 10));
        }
        return rows;
    });
}

test("test_all_files_reach_end_and_the_results_file_and_console_hold_the_same_lines", async (t) => {
    // Scenario: two plain files, each with a Write and Edits.
    const project = writeTwoPlainFilesProject(t);
    const printedTexts = captureOutput(t);
    // The walk runs over both files.
    const { summary, resultsFile } = await walkProject(project, project.storeFolder);
    // Both file records have the verdict end and the summary counts 2 ends.
    const records = readResultRecords(resultsFile);
    assert.equal(records.length, 3);
    assert.deepEqual(records.slice(0, 2).map((record) => [record.kind, record.verdict]), [["file", StepAllVerdict.End], ["file", StepAllVerdict.End]]);
    assert.deepEqual(records.slice(0, 2).map((record) => record.file), ["a.txt", "b.txt"]);
    assert.equal(records[2]!.kind, "summary");
    assert.equal(summary.end, 2);
    assert.equal(summary.files, 2);
    // The results file has 2 file lines and the summary line, and console.log printed the same lines.
    assert.deepEqual(printedTexts, readFileSync(resultsFile.toString(), "utf8").split("\n").filter((resultLine) => resultLine !== ""));
});

test("test_a_script_stop_is_recorded_with_its_refusal_and_the_walk_goes_on", async (t) => {
    // Scenario: s.txt has a script as its oldest event.
    const project = writeScriptOldestProject(t, false);
    captureOutput(t);
    // The walk runs with a store inside the cache folder, so r reaches its refusals.
    const { summary, resultsFile } = await walkProject(project, makeStoreFolderInsideCacheFolder(t));
    // The file has the verdict end and one stop on the script, replayed by r into a refusal.
    const fileRecord = readResultRecords(resultsFile)[0]!;
    assert.equal(fileRecord.verdict, StepAllVerdict.End);
    assert.equal(fileRecord.stops.length, 1);
    assert.equal(fileRecord.stops[0].eventType, FileEventType.ScriptMayWrite);
    assert.equal(fileRecord.stops[0].replay.kind, StepAllReplayKind.Refused);
    assert.match(fileRecord.stops[0].replay.reason, /the gap reaches the start of the history/);
    // The summary counts the refusal under its reason.
    assert.deepEqual(summary.replay, { proven: 0, derived: 0, refused: { [fileRecord.stops[0].replay.reason]: 1 }, failed: {} });
});

test("test_a_file_whose_walk_throws_is_recorded_and_the_next_file_is_still_walked", async (t) => {
    // Scenario: one command copies y.txt onto x.txt and x.txt onto y.txt; c.txt is a plain file.
    const project = writeProjectFiles(t, new Map([["x.txt", "x\n"], ["y.txt", "y\n"], ["c.txt", "c1\n"]]), (projectFolder, filePathByFileName) => {
        const xPath = filePathByFileName.get("x.txt")!;
        const yPath = filePathByFileName.get("y.txt")!;
        return [
            ...makeBashRows(projectFolder, "toolu_x1", `cp ${yPath} ${xPath} && cp ${xPath} ${yPath}`, 10),
            ...makeEditRows(projectFolder, "toolu_c1", filePathByFileName.get("c.txt")!, "c0", "c1", "c0\n", 20),
        ];
    });
    captureOutput(t);
    // The walk runs and does not throw.
    const { summary, resultsFile } = await walkProject(project, project.storeFolder);
    // x.txt and y.txt have the verdict crash with the message, a stack and null event fields.
    const records = readResultRecords(resultsFile);
    for (const crashedRecord of records.slice(0, 2)) {
        assert.equal(crashedRecord.verdict, StepAllVerdict.Crash);
        assert.match(crashedRecord.crash.message, /are each born from the other/);
        assert.equal(typeof crashedRecord.crash.stack, "string");
        assert.deepEqual([crashedRecord.crash.nextEventIndex, crashedRecord.crash.eventType, crashedRecord.crash.source], [null, null, null]);
    }
    // c.txt is still walked to its end.
    assert.equal(records[2]!.file, "c.txt");
    assert.equal(records[2]!.verdict, StepAllVerdict.End);
    assert.equal(records[2]!.crash, null);
    assert.deepEqual([summary.end, summary.crash, summary.bFailure], [1, 2, 0]);
});

test("test_the_b_walk_of_a_fresh_walk_returns_to_position_0_with_one_step_for_each_stored_commit_but_one", async (t) => {
    // Scenario: a.txt has a Write and two Edits.
    const project = writeTwoPlainFilesProject(t);
    captureOutput(t);
    // The walk runs.
    const { resultsFile } = await walkProject(project, project.storeFolder);
    // The b walk of a.txt took (stored commits - 1) steps and found no failure.
    const aRecord = readResultRecords(resultsFile)[0]!;
    const aRepoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileByName.get("a.txt")!);
    const storedPositions = listInverseCommits(aRepoFolder, "a.txt", false).map((storedCommit) => storedCommit.position);
    assert.equal(storedPositions.length > 2, true);
    assert.equal(aRecord.stepsBackward, storedPositions.length - 1);
    assert.deepEqual(aRecord.backwardFailures, []);
    assert.equal(aRecord.verdict, StepAllVerdict.End);
});

test("test_checkBackwardWalk_reports_a_history_that_is_not_ascending_and_a_position_without_a_commit", async (t) => {
    // Scenario: the repo of a.txt holds its stored commits after a walk.
    const project = writeTwoPlainFilesProject(t);
    captureOutput(t);
    await walkProject(project, project.storeFolder);
    const aRepoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.fileByName.get("a.txt")!);
    const storedPositions = listInverseCommits(aRepoFolder, "a.txt", false).map((storedCommit) => storedCommit.position);
    // The stored history gives no failure.
    assert.deepEqual(checkBackwardWalk([...storedPositions], aRepoFolder, "a.txt").failures, []);
    // The history [0, 2, 1] steps back from 1 to 2, which is not lower.
    const unorderedResult = checkBackwardWalk([0, 2, 1], aRepoFolder, "a.txt");
    assert.equal(unorderedResult.failures.length > 0, true);
    assert.equal(unorderedResult.failures.some((failure) => /is not lower than/.test(failure)), true);
    // The history [0, M, M + 1] steps back to the position M, which is above every stored position and has no stored commit.
    const missingPosition = Math.max(...storedPositions) + 1;
    const missingCommitResult = checkBackwardWalk([0, missingPosition, missingPosition + 1], aRepoFolder, "a.txt");
    assert.equal(missingCommitResult.failures.some((failure) => failure.includes(`no stored commit at position ${missingPosition}`)), true);
});

test("test_the_summary_counts_the_stops_by_event_type", async (t) => {
    // Scenario: s.txt stops on a script; e.txt stops on an Edit that fits neither way.
    const project = writeScriptOldestProject(t, true);
    captureOutput(t);
    // The walk runs.
    const { summary } = await walkProject(project, makeStoreFolderInsideCacheFolder(t));
    // The summary counts one stop of each event type, and one refusal.
    assert.deepEqual(summary.stopsByEventType, { [FileEventType.ScriptMayWrite]: 1, [FileEventType.EditRow]: 1 });
    assert.equal(Object.values(summary.replay.refused).length, 1);
});

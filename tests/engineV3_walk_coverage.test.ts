// The walk coverage: how far a file has been walked, stored beside its inverse repo.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { createFileStep, type FileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit } from "../engineV3/engineV3_file_step_write.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { WALK_COVERAGE_FILE_NAME, isInstantSpannedByWalkCoverage, readWalkCoverage, writeWalkCoverage } from "../engineV3/engineV3_walk_coverage.ts";
import { makeEditRows, makeInstant, writeProject, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

type WalkedProject = { project: Project; repoFolder: Path; fileName: string; step: FileStep };

// Disk text "three"; Edit one to two at second 10, Edit two to three at second 20.
function writeTwoEditProject(t: TestContext): Project {
    return writeProject(t, "three\n", (projectFolder, filePath) => [
        ...makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePath, "two", "three", null, 20),
    ]);
}

// Disk text "same": the only Edit changes nothing, so no state differs from the disk text.
function writeSparseProject(t: TestContext): Project {
    return writeProject(t, "same\n", (projectFolder, filePath) => makeEditRows(projectFolder, "toolu_s", filePath, "same", "same", "same\n", 10));
}

function startWalk(project: Project): WalkedProject {
    const projectFiles = [{ file: project.file, transcriptFile: project.file }];
    buildOnDemandInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const events = createProjectEventsLoader(projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    const fileName = basename(project.file.toString());
    const step = createFileStep(events, listInverseCommits(repoFolder, fileName, true));
    return { project, repoFolder, fileName, step };
}

test("test_coverage_of_a_fresh_on_demand_repo_has_the_disk_time_as_tip_and_is_not_finished", (t) => {
    // Scenario: a repo that holds only the disk-now commit.
    const walked = startWalk(writeTwoEditProject(t));
    // The coverage is written once.
    const coverage = writeWalkCoverage(walked.repoFolder, walked.fileName, false);
    // The tip instant is the disk modified time of the file, and the walk is not finished.
    assert.equal(coverage.tipInstant!.getTime(), statSync(walked.project.file.toString()).mtime.getTime());
    assert.equal(coverage.isFinished, false);
});

test("test_coverage_tip_moves_to_the_instant_of_the_newest_written_edit_after_one_step", (t) => {
    // Scenario: one forward step writes the text just before the newest Edit.
    const walked = startWalk(writeTwoEditProject(t));
    const written = stepFileAndWriteCommit(walked.repoFolder, walked.fileName, walked.step, undefined);
    assert.equal(written.result.outcome, InverseStepOutcome.NewText);
    // The coverage is written after the step.
    const coverage = writeWalkCoverage(walked.repoFolder, walked.fileName, false);
    // The tip instant is the instant of the tip commit, which is the second of that Edit.
    assert.equal(coverage.tipInstant!.getTime(), written.tipCommit.instant!.getTime());
    assert.equal(coverage.tipInstant!.getTime(), makeInstant(20).getTime());
});

test("test_an_instant_at_or_after_the_tip_is_spanned", () => {
    // Scenario: a coverage with the tip at second 20 and an unfinished walk.
    const coverage = { tipInstant: makeInstant(20), isFinished: false };
    // The tip instant itself and a later instant are spanned.
    assert.equal(isInstantSpannedByWalkCoverage(coverage, makeInstant(20)), true);
    assert.equal(isInstantSpannedByWalkCoverage(coverage, makeInstant(35)), true);
});

test("test_an_instant_before_the_tip_is_not_spanned_until_the_walk_is_finished", () => {
    // Scenario: a coverage with the tip at second 20.
    const unfinishedCoverage = { tipInstant: makeInstant(20), isFinished: false };
    // An older instant is not spanned.
    assert.equal(isInstantSpannedByWalkCoverage(unfinishedCoverage, makeInstant(15)), false);
    // The same coverage, finished, spans it.
    assert.equal(isInstantSpannedByWalkCoverage({ ...unfinishedCoverage, isFinished: true }, makeInstant(15)), true);
    // A coverage with no tip instant spans nothing until it is finished.
    assert.equal(isInstantSpannedByWalkCoverage({ tipInstant: null, isFinished: false }, makeInstant(15)), false);
});

test("test_finished_stays_true_on_later_writes", (t) => {
    // Scenario: the coverage is written finished.
    const walked = startWalk(writeTwoEditProject(t));
    assert.equal(writeWalkCoverage(walked.repoFolder, walked.fileName, true).isFinished, true);
    // A later write that says not finished.
    const laterCoverage = writeWalkCoverage(walked.repoFolder, walked.fileName, false);
    // The coverage is still finished, on the result and on disk.
    assert.equal(laterCoverage.isFinished, true);
    assert.equal(readWalkCoverage(walked.repoFolder)!.isFinished, true);
});

test("test_a_repo_without_the_sidecar_reads_as_undefined", (t) => {
    // Scenario: a repo that was never covered.
    const walked = startWalk(writeTwoEditProject(t));
    // Reading its coverage gives undefined.
    assert.equal(readWalkCoverage(walked.repoFolder), undefined);
});

test("test_the_written_coverage_reads_back_with_the_same_tip_instant", (t) => {
    // Scenario: a coverage is written.
    const walked = startWalk(writeTwoEditProject(t));
    const writtenCoverage = writeWalkCoverage(walked.repoFolder, walked.fileName, false);
    // Reading it gives the same tip instant and the same finished flag.
    const readCoverage = readWalkCoverage(walked.repoFolder)!;
    assert.equal(readCoverage.tipInstant!.getTime(), writtenCoverage.tipInstant!.getTime());
    assert.equal(readCoverage.isFinished, writtenCoverage.isFinished);
});

test("test_the_sparse_hole_is_spanned_after_the_finished_walk", (t) => {
    // Scenario: every state of the file has the disk text, so the repo keeps only the disk-now commit.
    const walked = startWalk(writeSparseProject(t));
    const olderThanDiskInstant = new Date(statSync(walked.project.file.toString()).mtime.getTime() - 60000);
    // Before the walk is finished, an instant older than the disk time is not spanned.
    const coverageBefore = writeWalkCoverage(walked.repoFolder, walked.fileName, false);
    assert.equal(isInstantSpannedByWalkCoverage(coverageBefore, olderThanDiskInstant), false);
    // The walk runs to its end and writes no commit.
    const written = stepFileAndWriteCommit(walked.repoFolder, walked.fileName, walked.step, undefined);
    assert.equal(written.result.outcome, InverseStepOutcome.NoOlderChange);
    assert.equal(listInverseCommits(walked.repoFolder, walked.fileName, false).length, 1);
    // After the finished walk, the same instant is spanned.
    const coverageAfter = writeWalkCoverage(walked.repoFolder, walked.fileName, written.result.outcome === InverseStepOutcome.NoOlderChange);
    assert.equal(isInstantSpannedByWalkCoverage(coverageAfter, olderThanDiskInstant), true);
});

test("test_the_sidecar_is_written_through_a_temporary_file", (t) => {
    // Scenario: a coverage is written.
    const walked = startWalk(writeTwoEditProject(t));
    writeWalkCoverage(walked.repoFolder, walked.fileName, false);
    // The repo folder holds the sidecar and no temporary file.
    assert.equal(existsSync(join(walked.repoFolder.toString(), WALK_COVERAGE_FILE_NAME)), true);
    assert.deepEqual(readdirSync(walked.repoFolder.toString()).filter((entry) => entry.endsWith(".tmp")), []);
});

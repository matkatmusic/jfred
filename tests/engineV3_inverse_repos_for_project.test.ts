// The stale repo list: which repos of a store no longer match the logs or the disk.

import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Path, Uuid } from "../src/structures/domain.ts";
import { readEarliestBoundary, type EarliestBoundary } from "../engineV3/engineV3_earliest_boundary.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { buildInverseReposForFiles, buildOnDemandInverseReposForFiles, listBarRowNamesOfProjectFiles, listProjectFilesWithStaleInverseRepos, readInverseReposSettingsFromArguments, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { createTerminalBarsSink } from "../engineV3/engineV3_inverse_repos_terminal_bars.ts";
import { makeBashRows, makeEditRows, PROJECT_FILE_NAME, writeProject, writeProjectFiles, type Project } from "./engineV3_step_test_projects.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));

function writeOneEditProject(t: Parameters<typeof writeProject>[0]): Project {
    return writeProject(t, "two\n", (projectFolder, filePath) => makeEditRows(projectFolder, "toolu_a", filePath, "one", "two", null, 10));
}

function makeProjectFiles(project: Project): ProjectFile[] {
    return [{ file: project.file, transcriptFile: project.file }];
}

function buildOnDemandRepoForProject(project: Project): void {
    buildOnDemandInverseReposForFiles(project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
}

function listStaleFiles(project: Project): ProjectFile[] {
    return listProjectFilesWithStaleInverseRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder]);
}

test("test_a_repo_made_by_the_on_demand_build_is_not_stale_while_the_logs_stay_equal", (t) => {
    // Scenario: a repo built by the on-demand build is not listed while logs and disk stay equal.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandRepoForProject(project);
    // the stale list is empty.
    assert.deepEqual(listStaleFiles(project), []);
});

test("test_a_repo_is_stale_after_the_log_file_grows", (t) => {
    // Scenario: a repo is listed after one line is added to a log file.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandRepoForProject(project);
    // one line is added to the log file.
    appendFileSync(join(project.jsonlsFolder.toString(), "s1.jsonl"), JSON.stringify({ type: "summary" }) + "\n");
    // the project file is listed.
    assert.deepEqual(listStaleFiles(project), makeProjectFiles(project));
});

test("test_a_repo_is_stale_after_the_disk_text_changes", (t) => {
    // Scenario: a repo is listed after the text of the file on disk changes.
    // Steps:
    // a project file has an on-demand repo in the store.
    const project = writeOneEditProject(t);
    buildOnDemandRepoForProject(project);
    // the text of the file on disk changes.
    writeFileSync(project.file.toString(), "three\n");
    // the project file is listed.
    assert.deepEqual(listStaleFiles(project), makeProjectFiles(project));
});

test("test_a_file_without_a_repo_folder_is_not_stale_and_no_folder_is_made", (t) => {
    // Scenario: a file with no repo folder is not listed and the call makes no folder.
    // Steps:
    // the store folder exists and is empty.
    const project = writeOneEditProject(t);
    mkdirSync(project.storeFolder.toString());
    const listingBefore = readdirSync(project.storeFolder.toString(), { recursive: true });
    // the stale list is empty.
    assert.deepEqual(listStaleFiles(project), []);
    // the store folder listing is equal to the listing before the call.
    assert.deepEqual(readdirSync(project.storeFolder.toString(), { recursive: true }), listingBefore);
});

test("test_the_bar_rows_of_the_full_build_exist_for_a_file_outside_the_project_folder", (t) => {
    // Scenario: the full build draws its bars for a file outside the project folder without a throw.
    // Steps:
    // a project has one file inside the project folder and one file outside it, both with edits in the logs.
    const project = writeProjectFiles(t, new Map([["a.txt", "two\n"], ["../outside.md", "two\n"]]), (projectFolder, filePathByFileName) => [
        ...makeEditRows(projectFolder, "toolu_a", filePathByFileName.get("a.txt")!, "one", "two", null, 10),
        ...makeEditRows(projectFolder, "toolu_b", filePathByFileName.get("../outside.md")!, "one", "two", null, 20),
    ]);
    const projectFiles: ProjectFile[] = [...project.fileByName.values()].map((file) => ({ file, transcriptFile: file }));
    // the bars are drawn on a terminal stream, with the row names of the new function.
    const terminalStream = { isTTY: true, write: () => true };
    const barRowNames = listBarRowNamesOfProjectFiles(project.projectFolder, projectFiles.map((projectFile) => projectFile.file));
    const reportProgress = createTerminalBarsSink(terminalStream, barRowNames);
    // the full build does not throw.
    assert.doesNotThrow(() => buildInverseReposForFiles(project.projectFolder, projectFiles, [project.jsonlsFolder], [project.snapshotFolder], project.storeFolder, DISK_NOW_INSTANT, reportProgress));
});

function writeSecondLogFolder(project: Project, makeRows: (projectFolder: string) => object[]): Path {
    const secondLogFolder = join(project.rootFolder, "jsonls-two");
    mkdirSync(secondLogFolder);
    writeFileSync(join(secondLogFolder, "s2.jsonl"), makeRows(project.projectFolder.toString()).map((row) => JSON.stringify(row)).join("\n") + "\n");
    return new Path(secondLogFolder);
}

test("test_step_program_reads_two_jsonls_folders", (t) => {
    // Scenario: the command line names two log folders and two file-history folders.
    // Steps:
    // a project has edit rows in log folder one and a script row in log folder two.
    const project = writeOneEditProject(t);
    const secondLogFolder = writeSecondLogFolder(project, (projectFolder) => makeBashRows(projectFolder, "toolu_b", "echo hi", 20));
    const secondHistoryFolder = new Path(join(project.rootFolder, "file-history-two"));
    // the settings are read from a command line with comma lists.
    const settings = readInverseReposSettingsFromArguments([
        "--project", project.projectFolder.toString(),
        "--jsonls", `${project.jsonlsFolder.toString()},${secondLogFolder.toString()}`,
        "--file-history", `${project.snapshotFolder.toString()},${secondHistoryFolder.toString()}`,
        "--store", project.storeFolder.toString(),
    ]);
    // both folders of each list come back in the order given.
    assert.deepEqual(settings.jsonlsFolders, [project.jsonlsFolder, secondLogFolder]);
    assert.deepEqual(settings.fileHistoryFolders, [project.snapshotFolder, secondHistoryFolder]);
});

test("test_step_program_walks_a_file_with_its_edit_rows_in_the_second_jsonls_folder", (t) => {
    // Scenario: the only rows that name the file are in the second log folder.
    // Steps:
    // a project has its edit rows in log folder one; log folder two is empty of rows for the file.
    const project = writeOneEditProject(t);
    const secondLogFolder = writeSecondLogFolder(project, () => []);
    // the program runs with the second folder first and one forward step.
    const spawned = spawnSync(process.execPath, [
        "--import", "tsx", "engineV3/engineV3_inverse_repos_for_project.ts",
        "--project", project.projectFolder.toString(),
        "--jsonls", `${secondLogFolder.toString()},${project.jsonlsFolder.toString()}`,
        "--file-history", project.snapshotFolder.toString(),
        "--store", project.storeFolder.toString(),
        "--step", PROJECT_FILE_NAME,
    ], { input: "f\nq\n", cwd: join(dirname(fileURLToPath(import.meta.url)), ".."), encoding: "utf8", timeout: 110000 });
    assert.equal(spawned.status, 0, spawned.stderr);
    // the step line shows a new text: the edit rows of the other folder were read.
    const stepLine = spawned.stdout.split("\n").filter((outputLine) => outputLine.startsWith("{")).map((outputLine) => JSON.parse(outputLine) as Record<string, unknown>).find((printedLine) => "step" in printedLine)!;
    assert.equal(stepLine.outcome, InverseStepOutcome.NewText);
});

// An empty commit in the project repo; the boundary names it.
function makeBoundaryAtNewCommit(project: Project, message: string): EarliestBoundary {
    const projectFolder = project.projectFolder.toString();
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", message], { cwd: projectFolder });
    const commitHash = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectFolder, encoding: "utf8" }).trim();
    return readEarliestBoundary(project.projectFolder, new Uuid(commitHash));
}

function buildOnDemandRepoWithBoundary(project: Project, earliestBoundary: EarliestBoundary | undefined): boolean {
    const results = buildOnDemandInverseReposForFiles(project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {}, earliestBoundary);
    return results[0]!.wasReused;
}

test("test_a_store_built_without_a_boundary_is_reused_without_a_boundary", (t) => {
    // Scenario: a store built without a boundary is built again without a boundary.
    const project = writeOneEditProject(t);
    assert.equal(buildOnDemandRepoWithBoundary(project, undefined), false);
    // The second build reuses the repo.
    assert.equal(buildOnDemandRepoWithBoundary(project, undefined), true);
});

test("test_a_store_built_without_a_boundary_is_rebuilt_with_a_boundary", (t) => {
    // Scenario: a store built without a boundary is built again with a boundary.
    const project = writeOneEditProject(t);
    buildOnDemandRepoWithBoundary(project, undefined);
    const earliestBoundary = makeBoundaryAtNewCommit(project, "first boundary");
    // The stale list names the file, and the build does not reuse the repo.
    assert.deepEqual(listProjectFilesWithStaleInverseRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], earliestBoundary), makeProjectFiles(project));
    assert.equal(buildOnDemandRepoWithBoundary(project, earliestBoundary), false);
});

test("test_a_store_built_for_one_commit_is_rebuilt_for_another_commit", (t) => {
    // Scenario: a store built for commit one is built again for commit two.
    const project = writeOneEditProject(t);
    const firstBoundary = makeBoundaryAtNewCommit(project, "first boundary");
    const secondBoundary = makeBoundaryAtNewCommit(project, "second boundary");
    buildOnDemandRepoWithBoundary(project, firstBoundary);
    // The stale list names the file for commit two, and the build does not reuse the repo.
    assert.deepEqual(listProjectFilesWithStaleInverseRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], secondBoundary), makeProjectFiles(project));
    assert.equal(buildOnDemandRepoWithBoundary(project, secondBoundary), false);
});

test("test_a_store_built_for_a_commit_is_reused_for_the_same_commit", (t) => {
    // Scenario: a store built for a commit is built again for the same commit.
    const project = writeOneEditProject(t);
    const earliestBoundary = makeBoundaryAtNewCommit(project, "first boundary");
    buildOnDemandRepoWithBoundary(project, earliestBoundary);
    // The stale list is empty, and the build reuses the repo.
    assert.deepEqual(listProjectFilesWithStaleInverseRepos(project.storeFolder, project.projectFolder, makeProjectFiles(project), [project.jsonlsFolder], earliestBoundary), []);
    assert.equal(buildOnDemandRepoWithBoundary(project, earliestBoundary), true);
});

test("test_a_step_child_without_no_walk_other_files_exits_on_sigterm", async (t) => {
    // Scenario: a marker-walk step child (no --no-walk-other-files) must die when it gets SIGTERM.
    // Steps:
    // a project has one edit row.
    const project = writeOneEditProject(t);
    // the step program starts with no --no-walk-other-files, and its input stays open.
    const child = spawn(process.execPath, [
        "--import", "tsx", "engineV3/engineV3_inverse_repos_for_project.ts",
        "--project", project.projectFolder.toString(),
        "--jsonls", project.jsonlsFolder.toString(),
        "--file-history", project.snapshotFolder.toString(),
        "--store", project.storeFolder.toString(),
        "--step", PROJECT_FILE_NAME,
    ], { cwd: join(dirname(fileURLToPath(import.meta.url)), ".."), stdio: "pipe" });
    t.after(() => child.kill("SIGKILL"));
    const exitPromise = new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_exitCode, exitSignal) => resolve(exitSignal)));
    // the line "f" goes in, and the test waits for a printed line with "begin": the handler line has run by then.
    let printedText = "";
    const beginPromise = new Promise<void>((resolve) => child.stdout.on("data", (chunk: Buffer) => {
        printedText += chunk.toString();
        if (printedText.includes("begin")) {
            resolve();
        }
    }));
    child.stdin.write("f\n");
    await beginPromise;
    // the test sends SIGTERM, and a safety timer sends SIGKILL after 20 seconds.
    const safetyTimer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.kill("SIGTERM");
    const exitSignal = await exitPromise;
    clearTimeout(safetyTimer);
    // the child ended by the SIGTERM signal, not by the safety timer.
    assert.equal(exitSignal, "SIGTERM");
});

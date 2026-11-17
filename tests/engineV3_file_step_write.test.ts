// stepFileAndWriteCommit: one step of one file, its commit written into the inverse repo, the stored tip returned.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileStep } from "../engineV3/engineV3_file_step.ts";
import { stepFileAndWriteCommit, type WrittenStepResult } from "../engineV3/engineV3_file_step_write.ts";
import { listInverseCommits } from "../engineV3/engineV3_inverse_repo.ts";
import { buildOnDemandInverseReposForFiles, createProjectEventsLoader, getInverseRepoFolderForFile, type ProjectFile } from "../engineV3/engineV3_inverse_repos_for_project.ts";
import { Path } from "../src/structures/domain.ts";
import { InverseStepOutcome } from "../src/structures/vocabulary.ts";

const DISK_NOW_INSTANT = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
const FILE_NAME = "a.txt";
const MAX_STEPS_TO_REACH_THE_END = 10;

type Project = { projectFolder: Path; jsonlsFolder: Path; snapshotFolder: Path; storeFolder: Path; file: Path; projectFiles: ProjectFile[] };

function makeTempFolder(t: TestContext): string {
    const folder = mkdtempSync(join(tmpdir(), "engine-v3-file-step-write-"));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

function makeInstant(second: number): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + second * 1000);
}

function makeEditRows(toolUseId: string, filePath: string, oldString: string, newString: string, originalFile: string, second: number): object[] {
    const toolUseResult = { filePath, oldString, newString, replaceAll: false, structuredPatch: [], userModified: false, originalFile };
    const callContent = [{ type: "tool_use", id: toolUseId, name: "Edit", input: { file_path: filePath }, caller: { type: "direct" } }];
    const callRecord = { type: "assistant", uuid: `call-${toolUseId}`, timestamp: new Date(makeInstant(second).getTime() - 1).toISOString(), message: { role: "assistant", content: callContent } };
    const resultContent = [{ type: "tool_result", tool_use_id: toolUseId, content: "ok" }];
    const resultRecord = { type: "user", uuid: `result-${toolUseId}`, timestamp: makeInstant(second).toISOString(), message: { role: "user", content: resultContent }, toolUseResult };
    return [callRecord, resultRecord];
}

function runGit(folder: string, args: string[], second: number): void {
    const commitDate = makeInstant(second).toISOString();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: folder, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate }, stdio: "pipe" });
}

// A git project holding a.txt: committed as "one", then edited to "two", then edited to "three" (the text on disk). One transcript names both edits.
function makeProject(t: TestContext): Project {
    const rootFolder = makeTempFolder(t);
    const projectFolder = join(rootFolder, "project");
    const jsonlsFolder = join(rootFolder, "jsonls");
    const snapshotFolder = join(rootFolder, "file-history");
    mkdirSync(projectFolder, { recursive: true });
    mkdirSync(jsonlsFolder);
    mkdirSync(snapshotFolder);
    runGit(projectFolder, ["init", "-q"], 0);
    writeFileSync(join(projectFolder, FILE_NAME), "one\n");
    runGit(projectFolder, ["add", FILE_NAME], 5);
    runGit(projectFolder, ["commit", "-q", "-m", "first"], 5);
    writeFileSync(join(projectFolder, FILE_NAME), "three\n");
    const file = new Path(join(projectFolder, FILE_NAME));
    const records = [
        ...makeEditRows("toolu_first", file.toString(), "one", "two", "one\n", 20),
        ...makeEditRows("toolu_second", file.toString(), "two", "three", "two\n", 30),
    ];
    writeFileSync(join(jsonlsFolder, "s1.jsonl"), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    return {
        projectFolder: new Path(projectFolder),
        jsonlsFolder: new Path(jsonlsFolder),
        snapshotFolder: new Path(snapshotFolder),
        storeFolder: new Path(join(rootFolder, "store")),
        file,
        projectFiles: [{ file, transcriptFile: file }],
    };
}

// Builds the on-demand repo (only the position-0 commit) and returns its folder plus the step made from the stored commits.
function buildRepoAndStep(project: Project) {
    buildOnDemandInverseReposForFiles(project.projectFolder, project.projectFiles, [project.jsonlsFolder], project.storeFolder, DISK_NOW_INSTANT, () => {});
    const repoFolder = getInverseRepoFolderForFile(project.storeFolder, project.projectFolder, project.file);
    const events = createProjectEventsLoader(project.projectFiles, [project.jsonlsFolder], [project.snapshotFolder])(0);
    const step = createFileStep(events, listInverseCommits(repoFolder, FILE_NAME, true));
    return { repoFolder, step };
}

test("test_a_step_that_writes_a_state_adds_one_commit_and_returns_it_as_the_tip", (t) => {
    // Scenario: one step that writes a state adds exactly one commit, and that commit comes back as the tip.
    // A project has a.txt with two Edit rows in its log.
    const project = makeProject(t);
    // The on-demand repo holds only the position-0 commit, and the step is made from the stored commits.
    const { repoFolder, step } = buildRepoAndStep(project);
    assert.equal(listInverseCommits(repoFolder, FILE_NAME, false).length, 1);
    // The function runs once.
    const written = stepFileAndWriteCommit(repoFolder, FILE_NAME, step, undefined);
    // The repo now holds two commits.
    const commitsAfter = listInverseCommits(repoFolder, FILE_NAME, false);
    assert.equal(commitsAfter.length, 2);
    // The tip commit is the last listed commit.
    assert.equal(written.tipCommit.commitHash.toString(), commitsAfter[commitsAfter.length - 1]!.commitHash.toString());
    // The step wrote new text.
    assert.equal(written.result.outcome, InverseStepOutcome.NewText);
});

test("test_a_step_that_writes_nothing_returns_the_stored_tip_and_adds_no_commit", (t) => {
    // Scenario: a step that reaches the end of the events writes nothing, so the repo and its tip stay as they were.
    // A project has a.txt with two Edit rows in its log.
    const project = makeProject(t);
    // The on-demand repo holds only the position-0 commit, and the step is made from the stored commits.
    const { repoFolder, step } = buildRepoAndStep(project);
    // The function runs until a step ends with NoOlderChange; the stored commits are read just before every call.
    let commitsBeforeLastCall = listInverseCommits(repoFolder, FILE_NAME, false);
    let lastWritten: WrittenStepResult | undefined;
    for (let stepNumber = 0; stepNumber < MAX_STEPS_TO_REACH_THE_END; stepNumber++) {
        if (lastWritten?.result.outcome !== InverseStepOutcome.NoOlderChange) {
            commitsBeforeLastCall = listInverseCommits(repoFolder, FILE_NAME, false);
            lastWritten = stepFileAndWriteCommit(repoFolder, FILE_NAME, step, undefined);
        }
    }
    // The last call ended with NoOlderChange.
    assert.equal(lastWritten!.result.outcome, InverseStepOutcome.NoOlderChange);
    // The commit count did not change during that call.
    assert.equal(listInverseCommits(repoFolder, FILE_NAME, false).length, commitsBeforeLastCall.length);
    // The returned tip is the same commit as the stored tip before that call.
    assert.equal(lastWritten!.tipCommit.commitHash.toString(), commitsBeforeLastCall[commitsBeforeLastCall.length - 1]!.commitHash.toString());
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Path } from "../src/structures/domain.ts";
import { CheckedOutRepo, InverseRepo } from "../engineV3/engineV3_checked_out_repo.ts";
import { makeInverseRepo } from "../engineV3/engineV3_make_inverse_repo.ts";

const SCENARIO_REPO_TAR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scenarios", "executed", "s84-multiagent-scripts-git-baseline", "repo.git.tar");
const GIT_IDENTITY_ENV = { GIT_AUTHOR_NAME: "s", GIT_AUTHOR_EMAIL: "s@example.com", GIT_COMMITTER_NAME: "s", GIT_COMMITTER_EMAIL: "s@example.com" };

type SourceStep = { subject: string; writes: Record<string, string>; removes: string[] };

// The user's example: B is created, changed, then removed by the last commit.
const DELETED_FILE_STEPS: SourceStep[] = [
    { subject: "initial commit", writes: { ".gitignore": "node_modules\n" }, removes: [] },
    { subject: "A created, B created", writes: { "A.txt": "A one\n", "B.txt": "B one\n" }, removes: [] },
    { subject: "A changed", writes: { "A.txt": "A two\n" }, removes: [] },
    { subject: "B changed", writes: { "B.txt": "B two, longer\n" }, removes: [] },
    { subject: "B removed", writes: {}, removes: ["B.txt"] },
];

function runGit(repoFolder: string, gitArguments: string[], env: Record<string, string> = {}): string {
    return execFileSync("git", ["-C", repoFolder, "-c", "commit.gpgsign=false", ...gitArguments], { encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

// The scenario tar is copied into a new temp folder first: nothing is extracted inside the scenarios folder.
function extractScenarioRepo(): Path {
    const repoFolder = mkdtempSync(join(tmpdir(), "checked-out-source-"));
    copyFileSync(SCENARIO_REPO_TAR, join(repoFolder, "repo.git.tar"));
    execFileSync("tar", ["-xf", "repo.git.tar"], { cwd: repoFolder });
    // The tar holds only .git: write the HEAD files into the work tree of the temp copy.
    runGit(repoFolder, ["checkout", "-q", "-f", "HEAD"]);
    return new Path(repoFolder);
}

function buildDeletedFileRepo(): Path {
    const repoFolder = mkdtempSync(join(tmpdir(), "checked-out-deleted-"));
    runGit(repoFolder, ["init", "-q"]);
    for (const [index, step] of DELETED_FILE_STEPS.entries()) {
        for (const [fileName, text] of Object.entries(step.writes)) {
            writeFileSync(join(repoFolder, fileName), text);
        }
        for (const fileName of step.removes) {
            rmSync(join(repoFolder, fileName));
        }
        runGit(repoFolder, ["add", "-A"]);
        const dateText = `${1_700_000_000 + index * 60} +0000`;
        runGit(repoFolder, ["commit", "-q", "-m", step.subject], { ...GIT_IDENTITY_ENV, GIT_AUTHOR_DATE: dateText, GIT_COMMITTER_DATE: dateText });
    }
    return new Path(repoFolder);
}

// makeInverseRepo returns a bare repo; a clone gives it a work tree that can be checked out.
function makeCheckedOutInverseRepo(sourceRepoFolder: Path): InverseRepo {
    const cloneFolder = join(mkdtempSync(join(tmpdir(), "checked-out-inverse-")), "inverse");
    execFileSync("git", ["clone", "-q", makeInverseRepo(sourceRepoFolder).toString(), cloneFolder]);
    return new InverseRepo(new Path(cloneFolder));
}

function verifyInverseCheckoutAtEveryIndex(sourceRepoFolder: Path): void {
    const projectRepo = new CheckedOutRepo(sourceRepoFolder);
    const inverseRepo = makeCheckedOutInverseRepo(sourceRepoFolder);
    const projectRepoCommits = projectRepo.getNumCommits();
    // the inverse repo has one more commit than the project repo.
    assert.equal(inverseRepo.getNumCommits(), projectRepoCommits + 1);
    for (let i = 0; i < projectRepoCommits; i++) {
        // inverse commit i shows the project commit at index (count - 1 - i), counting from 0.
        inverseRepo.checkout(i);
        projectRepo.checkout(projectRepoCommits - 1 - i);
        assert.deepEqual(inverseRepo.getTreeState(), projectRepo.getTreeState(), `inverse commit ${i}`);
    }
    // the last inverse commit shows the state before the first project commit: no files.
    inverseRepo.checkout(projectRepoCommits);
    assert.deepEqual(inverseRepo.getTreeState(), []);
}

function verifyInverseRewindToEveryIndex(sourceRepoFolder: Path): void {
    const projectRepo = new CheckedOutRepo(sourceRepoFolder);
    const inverseRepo = makeCheckedOutInverseRepo(sourceRepoFolder);
    for (let i = 0; i < projectRepo.getNumCommits(); i++) {
        // the inverse repo rewinds to the state of project commit i.
        projectRepo.checkout(i);
        inverseRepo.rewindTo(i);
        assert.deepEqual(inverseRepo.getTreeState(), projectRepo.getTreeState(), `project commit ${i}`);
    }
}

test("test_checkout_of_inverse_commit_i_shows_the_tree_of_project_commit_count_minus_1_minus_i_for_a_repo_with_edits", () => {
    // Scenario: the scenario repo s84 has 3 commits that only change inventory.py.
    // Steps: check out inverse commit i and project commit (count - 1 - i); the files on disk are the same.
    verifyInverseCheckoutAtEveryIndex(extractScenarioRepo());
});

test("test_checkout_of_inverse_commit_i_shows_the_tree_of_project_commit_count_minus_1_minus_i_for_a_repo_whose_last_change_deletes_a_file", () => {
    // Scenario: file B is created, changed, then removed by the last commit.
    // Steps: check out inverse commit i and project commit (count - 1 - i); the files on disk are the same.
    verifyInverseCheckoutAtEveryIndex(buildDeletedFileRepo());
});

test("test_rewindTo_i_shows_the_tree_of_project_commit_i_for_a_repo_with_edits", () => {
    // Scenario: the scenario repo s84 has 3 commits that only change inventory.py.
    // Steps: check out project commit i, rewind the inverse repo to i; the files on disk are the same.
    verifyInverseRewindToEveryIndex(extractScenarioRepo());
});

test("test_rewindTo_i_shows_the_tree_of_project_commit_i_for_a_repo_whose_last_change_deletes_a_file", () => {
    // Scenario: file B is created, changed, then removed by the last commit.
    // Steps: check out project commit i, rewind the inverse repo to i; the files on disk are the same.
    verifyInverseRewindToEveryIndex(buildDeletedFileRepo());
});

test("test_checkout_of_an_index_past_the_last_commit_throws", () => {
    // Scenario: a commit index that does not exist is an error.
    // Steps: check out index 3 in a repo with 3 commits.
    const projectRepo = new CheckedOutRepo(extractScenarioRepo());
    assert.throws(() => projectRepo.checkout(projectRepo.getNumCommits()), /no commit at index/);
});

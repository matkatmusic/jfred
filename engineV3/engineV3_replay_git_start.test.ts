import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Path } from "../src/structures/domain.ts";
import { createStartRepo, readStartPoint, type StartPoint } from "./engineV3_replay_git_start.ts";

const ORIGIN_URL = "https://example.com/origin.git";

type SourceRepo = { gitFolder: string; startPoint: StartPoint; hashes: string[]; laterCommit: string };

function readGit(folder: string, args: string[]): string {
    const gitArgs = ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args];
    return execFileSync("git", gitArgs, { cwd: folder, encoding: "utf8" }).trim();
}

function commitFile(folder: string, fileName: string): string {
    writeFileSync(join(folder, fileName), fileName);
    readGit(folder, ["add", "-A"]);
    readGit(folder, ["commit", "-q", "-m", fileName]);
    return readGit(folder, ["rev-parse", "HEAD"]);
}

function makeTempFolder(t: TestContext, prefix: string): string {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    t.after(() => rmSync(folder, { recursive: true, force: true }));
    return folder;
}

// Five linear commits: master, origin/master, WIP, develop are the first four; the fifth is later.
function makeSourceRepo(t: TestContext): SourceRepo {
    const workFolder = makeTempFolder(t, "engine-v3-start-source-");
    readGit(workFolder, ["init", "-q", "-b", "main"]);
    readGit(workFolder, ["remote", "add", "origin", ORIGIN_URL]);
    const hashes: string[] = [];
    for (const fileName of ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"]) {
        hashes.push(commitFile(workFolder, fileName));
    }
    const refNames = ["refs/heads/master", "refs/remotes/origin/master", "refs/heads/WIP", "refs/heads/develop"];
    const startPoint: StartPoint = { refs: [], headBranch: "refs/heads/develop", originHeadTarget: "refs/remotes/origin/master" };
    for (const [index, refName] of refNames.entries()) {
        startPoint.refs.push({ refName, fullHash: hashes[index] as string });
    }
    return { gitFolder: join(workFolder, ".git"), startPoint, hashes, laterCommit: hashes[4] as string };
}

function makeStartState(t: TestContext, source: SourceRepo): string {
    const stateFolder = makeTempFolder(t, "engine-v3-start-state-");
    createStartRepo(new Path(source.gitFolder), new Path(stateFolder), source.startPoint);
    return stateFolder;
}

test("test_createStartRepo_sets_each_ref_to_its_given_commit", (t) => {
    // Scenario: every listed ref in the state folder points at the full hash of its short hash.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    // each ref resolves to the matching full hash from the source repo
    for (const [index, startRef] of source.startPoint.refs.entries()) {
        assert.equal(readGit(stateFolder, ["rev-parse", startRef.refName]), source.hashes[index]);
    }
});

test("test_createStartRepo_leaves_out_a_commit_no_ref_reaches", (t) => {
    // Scenario: the later source commit is not reachable from the listed refs, so it is not copied.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    // the cat-file check fails because the object is missing
    assert.throws(() => readGit(stateFolder, ["cat-file", "-e", source.laterCommit]));
});

test("test_createStartRepo_makes_work_tree_files_equal_the_develop_commit", (t) => {
    // Scenario: the state folder holds the files of develop and nothing from the later commit.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    // the folder lists the files of the first four commits plus .git
    assert.deepEqual(readdirSync(stateFolder).sort(), [".git", "a.txt", "b.txt", "c.txt", "d.txt"]);
});

test("test_createStartRepo_copies_the_origin_url", (t) => {
    // Scenario: the origin remote url of the source repo is the origin url of the state repo.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    // the state repo reports the same url
    assert.equal(readGit(stateFolder, ["config", "remote.origin.url"]), ORIGIN_URL);
});

test("test_createStartRepo_points_HEAD_at_develop", (t) => {
    // Scenario: HEAD is a symbolic ref to the develop branch.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    assert.equal(readGit(stateFolder, ["symbolic-ref", "HEAD"]), "refs/heads/develop");
});

test("test_createStartRepo_points_origin_HEAD_at_origin_master", (t) => {
    // Scenario: refs/remotes/origin/HEAD is a symbolic ref to origin/master.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    assert.equal(readGit(stateFolder, ["symbolic-ref", "refs/remotes/origin/HEAD"]), "refs/remotes/origin/master");
});

test("test_createStartRepo_makes_no_other_refs", (t) => {
    // Scenario: the state repo holds only the four listed refs and origin/HEAD, with no tags and no stash.
    const source = makeSourceRepo(t);
    const stateFolder = makeStartState(t, source);
    const refNames = readGit(stateFolder, ["for-each-ref", "--format=%(refname)"]).split("\n").sort();
    assert.deepEqual(refNames, ["refs/heads/WIP", "refs/heads/develop", "refs/heads/master", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"]);
});

test("test_readStartPoint_for_typesafe_playground_equals_the_four_hard_coded_start_refs", () => {
    // Scenario: the reflog rule gives the same 4 refs and HEAD that were hard-coded for typesafe-playground.
    const playground = new Path("/Users/matkatmusicllc/Programming/typesafe-playground");
    // the first chat line is stamped 2026-10-26T23:57:39.077Z
    const startPoint = readStartPoint(playground, new Date("2026-10-26T23:57:39.077Z"));
    const expectedRefs = [
        { refName: "refs/heads/WIP", fullHash: readGit(playground.toString(), ["rev-parse", "63e8fdb"]) },
        { refName: "refs/heads/develop", fullHash: readGit(playground.toString(), ["rev-parse", "2716f82"]) },
        { refName: "refs/heads/master", fullHash: readGit(playground.toString(), ["rev-parse", "cb136ca"]) },
        { refName: "refs/remotes/origin/master", fullHash: readGit(playground.toString(), ["rev-parse", "6510b84"]) },
    ];
    assert.deepEqual(startPoint.refs, expectedRefs);
    assert.equal(startPoint.headBranch, "refs/heads/develop");
    assert.equal(startPoint.originHeadTarget, "refs/remotes/origin/master");
});
